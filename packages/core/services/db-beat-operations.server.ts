import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { beatLearningGoals, beats } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import {
  DEFAULT_BEAT_KIND,
  type BeatKind,
} from "../features/beats/beat-kinds.js";
import { and, asc, eq } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";
import { Effect } from "effect";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/**
 * Flatten a beat row's `beatLearningGoals` join rows into a plain
 * `learningGoalIds` array — every read below returns this shape rather than
 * the raw join table, so callers never see the join table itself.
 */
const withLearningGoalIds = <
  T extends { beatLearningGoals: { learningGoalId: string }[] },
>(
  row: T
) => {
  const { beatLearningGoals: joins, ...rest } = row;
  return { ...rest, learningGoalIds: joins.map((j) => j.learningGoalId) };
};

export const createBeatOperations = (db: Database) => {
  /** Non-archived beats of a video, sorted by their fractional `order` key. */
  const listBeatsByVideoId = (videoId: string) =>
    makeDbCall(() =>
      db.query.beats.findMany({
        where: and(eq(beats.videoId, videoId), eq(beats.archived, false)),
        orderBy: asc(beats.order),
        with: { beatLearningGoals: { columns: { learningGoalId: true } } },
      })
    ).pipe(Effect.map((rows) => rows.map(withLearningGoalIds)));

  /**
   * Create a Beat in the Video's plan, with the given `title` (default
   * empty), `kind` (defaulting to Definition) and free-text `description`
   * (default empty). `beforeBeatId` anchors the new Beat immediately
   * before that one; `null`/absent appends to the end. Mirrors the
   * fractional-key positioning of {@link moveBeat}.
   */
  const createBeat = Effect.fn("createBeat")(function* (
    videoId: string,
    kind: BeatKind = DEFAULT_BEAT_KIND,
    beforeBeatId: string | null = null,
    title: string = "",
    description: string = ""
  ) {
    const existing = yield* listBeatsByVideoId(videoId);

    let prevOrder: string | null;
    let nextOrder: string | null;
    if (beforeBeatId === null) {
      prevOrder = existing.at(-1)?.order ?? null;
      nextOrder = null;
    } else {
      const idx = existing.findIndex((s) => s.id === beforeBeatId);
      if (idx === -1) {
        return yield* new NotFoundError({
          type: "beat",
          params: { id: beforeBeatId },
        });
      }
      prevOrder = existing[idx - 1]?.order ?? null;
      nextOrder = existing[idx]!.order;
    }

    const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

    const [beat] = yield* makeDbCall(() =>
      db
        .insert(beats)
        .values({
          videoId,
          kind,
          title,
          description,
          order: order!,
        })
        .returning()
    );

    if (!beat) {
      return yield* new UnknownDBServiceError({
        cause: "No beat was returned from the database",
      });
    }

    // A brand-new Beat has no Learning Goal links yet — skip the round trip.
    return { ...beat, learningGoalIds: [] as string[] };
  });

  const requireBeat = (id: string) =>
    Effect.gen(function* () {
      const updated = yield* makeDbCall(() =>
        db.query.beats.findFirst({
          where: eq(beats.id, id),
          with: { beatLearningGoals: { columns: { learningGoalId: true } } },
        })
      );
      if (!updated) {
        return yield* new NotFoundError({ type: "beat", params: { id } });
      }
      return withLearningGoalIds(updated);
    });

  const renameBeat = Effect.fn("renameBeat")(function* (
    id: string,
    title: string
  ) {
    yield* makeDbCall(() =>
      db.update(beats).set({ title }).where(eq(beats.id, id))
    );
    return yield* requireBeat(id);
  });

  /**
   * Set a Beat's free-text planning Beat Description (default `""`). Purely
   * an in-app authoring aid — never published. The description rides on the
   * beat row, so moving a Beat between Videos preserves it automatically.
   */
  const setBeatDescription = Effect.fn("setBeatDescription")(function* (
    id: string,
    description: string
  ) {
    yield* makeDbCall(() =>
      db.update(beats).set({ description }).where(eq(beats.id, id))
    );
    return yield* requireBeat(id);
  });

  const setBeatKind = Effect.fn("setBeatKind")(function* (
    id: string,
    kind: BeatKind
  ) {
    yield* makeDbCall(() =>
      db.update(beats).set({ kind }).where(eq(beats.id, id))
    );
    return yield* requireBeat(id);
  });

  /**
   * Replace the full set of Learning Goals a Beat serves (delete-then-insert,
   * same shape as {@link createDeliverableOperations}'s course/pitch links —
   * there is no incremental add/remove verb, only "set"). An empty array
   * clears every link; it is the caller's job (the CLI / editor mutation) to
   * decide whether that is allowed, since the "every Beat needs >=1 Learning
   * Goal" rule is a Section-scoped warning, not a DB constraint (a Beat's
   * Video can be standalone/pitch-bound with no Section, and moving a Beat
   * across Videos must never fail on this join).
   */
  const setBeatLearningGoals = Effect.fn("setBeatLearningGoals")(function* (
    id: string,
    learningGoalIds: readonly string[]
  ) {
    yield* requireBeat(id);
    const uniqueIds = [...new Set(learningGoalIds)];

    yield* makeDbCall(() =>
      db.delete(beatLearningGoals).where(eq(beatLearningGoals.beatId, id))
    );
    if (uniqueIds.length > 0) {
      yield* makeDbCall(() =>
        db
          .insert(beatLearningGoals)
          .values(
            uniqueIds.map((learningGoalId) => ({ beatId: id, learningGoalId }))
          )
      );
    }

    return yield* requireBeat(id);
  });

  const deleteBeat = Effect.fn("deleteBeat")(function* (id: string) {
    yield* makeDbCall(() =>
      db.update(beats).set({ archived: true }).where(eq(beats.id, id))
    );
    return { success: true as const };
  });

  /**
   * Move a Beat within its Video (reorder) or into another Video. Reassigns
   * `videoId` to the target and computes a fractional key strictly between the
   * drop neighbours. `beforeBeatId === null` appends to the target's end.
   * Mirrors the cross-section lesson move shape (ADR 0011/0013).
   */
  const moveBeat = Effect.fn("moveBeat")(function* (
    beatId: string,
    targetVideoId: string,
    beforeBeatId: string | null
  ) {
    yield* requireBeat(beatId);

    // The target's beats as they'd look without the moved one.
    const targetBeats = yield* listBeatsByVideoId(targetVideoId);
    const remaining = targetBeats.filter((s) => s.id !== beatId);

    let prevOrder: string | null;
    let nextOrder: string | null;
    if (beforeBeatId === null) {
      prevOrder = remaining.at(-1)?.order ?? null;
      nextOrder = null;
    } else {
      const idx = remaining.findIndex((s) => s.id === beforeBeatId);
      if (idx === -1) {
        return yield* new NotFoundError({
          type: "beat",
          params: { id: beforeBeatId },
        });
      }
      prevOrder = remaining[idx - 1]?.order ?? null;
      nextOrder = remaining[idx]!.order;
    }

    const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

    yield* makeDbCall(() =>
      db
        .update(beats)
        .set({ videoId: targetVideoId, order: order! })
        .where(eq(beats.id, beatId))
    );

    return yield* requireBeat(beatId);
  });

  return {
    listBeatsByVideoId,
    getBeatById: requireBeat,
    createBeat,
    renameBeat,
    setBeatDescription,
    setBeatKind,
    setBeatLearningGoals,
    deleteBeat,
    moveBeat,
  };
};

export class BeatOperationsService extends Effect.Service<BeatOperationsService>()(
  "BeatOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createBeatOperations(db);
    }),
  }
) {}
