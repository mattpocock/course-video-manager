import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { learningGoals } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  requireDraftVersionForLearningGoal,
  requireDraftVersionForSection,
} from "./draft-guard.server.js";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/**
 * Flatten a Learning Goal row's `beatLearningGoals` join rows into a plain
 * `beatIds` array — the Beats currently serving it. Read-only surface: this
 * is who serves the goal, not an editable link from this side (a Beat's
 * Learning Goals are set from the Beat, via BeatOperationsService).
 */
const withBeatIds = <T extends { beatLearningGoals: { beatId: string }[] }>(
  row: T
) => {
  const { beatLearningGoals: joins, ...rest } = row;
  return { ...rest, beatIds: joins.map((j) => j.beatId) };
};

export interface LearningGoalFields {
  title?: string;
  description?: string;
  priority?: number;
}

/** Drop undefined keys so a partial patch only touches the fields provided. */
const pruneLearningGoalFields = (
  fields: LearningGoalFields
): Record<string, string | number> => {
  const set: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) set[key] = value;
  }
  return set;
};

/**
 * Order value that places a row at the given anchor among `existing`
 * (already sorted ascending by `order`, with any row being repositioned
 * already excluded). `beforeLearningGoalId === null` appends to the end.
 * Shared by {@link createLearningGoalOperations}'s create and move — a plain
 * float midpoint, same as Section's and Lesson's own `order` column: a
 * Learning Goal only ever reorders within ONE Section (never moves between
 * Sections), so there is no need for the fractional-indexing scheme Beat
 * uses to support cross-Video moves.
 */
const computeOrder = (
  existing: readonly { id: string; order: number }[],
  beforeLearningGoalId: string | null
): number | "not-found" => {
  if (beforeLearningGoalId === null) {
    return (existing.at(-1)?.order ?? 0) + 1;
  }
  const idx = existing.findIndex((g) => g.id === beforeLearningGoalId);
  if (idx === -1) {
    return "not-found";
  }
  const anchor = existing[idx]!;
  const prev = existing[idx - 1];
  return prev ? (prev.order + anchor.order) / 2 : anchor.order - 1;
};

export const createLearningGoalOperations = (db: Database) => {
  /** Non-archived Learning Goals of a Section, sorted by their `order`. */
  const listLearningGoalsBySectionId = (sectionId: string) =>
    makeDbCall(() =>
      db.query.learningGoals.findMany({
        where: and(
          eq(learningGoals.sectionId, sectionId),
          eq(learningGoals.archived, false)
        ),
        orderBy: asc(learningGoals.order),
        with: { beatLearningGoals: { columns: { beatId: true } } },
      })
    ).pipe(Effect.map((rows) => rows.map(withBeatIds)));

  const requireLearningGoal = (id: string) =>
    Effect.gen(function* () {
      const row = yield* makeDbCall(() =>
        db.query.learningGoals.findFirst({
          where: eq(learningGoals.id, id),
          with: { beatLearningGoals: { columns: { beatId: true } } },
        })
      );
      if (!row) {
        return yield* new NotFoundError({
          type: "learningGoal",
          params: { id },
        });
      }
      return withBeatIds(row);
    });

  /**
   * Create a Learning Goal in the Section's plan — the pre-Beat statement of
   * what a learner should come away knowing (Learning Goals -> scaffold
   * Lessons/Videos/Beats -> Script -> recording -> article). `title` defaults
   * empty, `priority` defaults 2 (the column default), matching Lesson's
   * triage convention (lower sorts first). `beforeLearningGoalId` anchors the
   * new row immediately before that one; `null`/absent appends to the end
   * (see {@link computeOrder}).
   */
  const createLearningGoal = Effect.fn("createLearningGoal")(function* (
    sectionId: string,
    fields: LearningGoalFields = {},
    beforeLearningGoalId: string | null = null
  ) {
    yield* requireDraftVersionForSection(db, sectionId);

    const existing = yield* listLearningGoalsBySectionId(sectionId);
    const order = computeOrder(existing, beforeLearningGoalId);
    if (order === "not-found") {
      return yield* new NotFoundError({
        type: "learningGoal",
        params: { id: beforeLearningGoalId },
      });
    }

    const [created] = yield* makeDbCall(() =>
      db
        .insert(learningGoals)
        .values({
          sectionId,
          order,
          ...pruneLearningGoalFields(fields),
        })
        .returning()
    );

    if (!created) {
      return yield* new UnknownDBServiceError({
        cause: "No learning goal was returned from the database",
      });
    }

    // A brand-new Learning Goal has no Beats serving it yet — skip the round trip.
    return { ...created, beatIds: [] as string[] };
  });

  /**
   * Patch a Learning Goal's title / description / priority. Undefined fields
   * are left untouched (see {@link pruneLearningGoalFields}) — this is the
   * one write both "edit" and "right-click rename" route through.
   */
  const updateLearningGoal = Effect.fn("updateLearningGoal")(function* (
    id: string,
    fields: LearningGoalFields
  ) {
    yield* requireDraftVersionForLearningGoal(db, id);
    const set = pruneLearningGoalFields(fields);

    yield* makeDbCall(() =>
      db.update(learningGoals).set(set).where(eq(learningGoals.id, id))
    );
    return yield* requireLearningGoal(id);
  });

  /**
   * Reorder a Learning Goal within its Section. `beforeLearningGoalId ===
   * null` moves it to the end (see {@link computeOrder}, shared with
   * {@link createLearningGoal}). A Learning Goal has no cross-Section move
   * (unlike Beat across Videos), so there is no target-parent argument.
   */
  const moveLearningGoal = Effect.fn("moveLearningGoal")(function* (
    id: string,
    beforeLearningGoalId: string | null
  ) {
    yield* requireDraftVersionForLearningGoal(db, id);
    const current = yield* requireLearningGoal(id);

    const siblings = yield* listLearningGoalsBySectionId(current.sectionId);
    const remaining = siblings.filter((g) => g.id !== id);
    const order = computeOrder(remaining, beforeLearningGoalId);
    if (order === "not-found") {
      return yield* new NotFoundError({
        type: "learningGoal",
        params: { id: beforeLearningGoalId },
      });
    }

    yield* makeDbCall(() =>
      db.update(learningGoals).set({ order }).where(eq(learningGoals.id, id))
    );
    return yield* requireLearningGoal(id);
  });

  const deleteLearningGoal = Effect.fn("deleteLearningGoal")(function* (
    id: string
  ) {
    yield* requireDraftVersionForLearningGoal(db, id);
    yield* makeDbCall(() =>
      db
        .update(learningGoals)
        .set({ archived: true })
        .where(eq(learningGoals.id, id))
    );
    return { success: true as const };
  });

  return {
    listLearningGoalsBySectionId,
    getLearningGoalById: requireLearningGoal,
    createLearningGoal,
    updateLearningGoal,
    moveLearningGoal,
    deleteLearningGoal,
  };
};

export class LearningGoalOperationsService extends Effect.Service<LearningGoalOperationsService>()(
  "LearningGoalOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createLearningGoalOperations(db);
    }),
  }
) {}
