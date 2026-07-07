import {
  DrizzleService,
  type Database,
} from "@/services/drizzle-service.server";
import { beats } from "@/db/schema";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { DEFAULT_BEAT_KIND, type BeatKind } from "@/features/beats/beat-kinds";
import { and, asc, eq } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";
import { Effect } from "effect";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createBeatOperations = (db: Database) => {
  /** Non-archived beats of a video, sorted by their fractional `order` key. */
  const listBeatsByVideoId = (videoId: string) =>
    makeDbCall(() =>
      db.query.beats.findMany({
        where: and(eq(beats.videoId, videoId), eq(beats.archived, false)),
        orderBy: asc(beats.order),
      })
    );

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

    return beat;
  });

  const requireBeat = (id: string) =>
    Effect.gen(function* () {
      const [updated] = yield* makeDbCall(() =>
        db.select().from(beats).where(eq(beats.id, id))
      );
      if (!updated) {
        return yield* new NotFoundError({ type: "beat", params: { id } });
      }
      return updated;
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
