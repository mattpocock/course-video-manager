import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { clipMockups } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq } from "drizzle-orm";
import { generateNKeysBetween } from "fractional-indexing";
import { Effect } from "effect";

/**
 * Row-level operations for Clip Mockups — one still image and one spoken line
 * belonging to a Video, ordered like a Beat.
 *
 * DELIBERATELY ONLY THE ROW. The frame itself is a PNG under
 * `{CLIP_MOCKUP_DIR}/{video.lineageId}/` and `imagePath` is relative to that
 * directory, but nothing here ever touches a disk: `@cvm/core` is deployed to
 * a box that has none. Copying the PNG in, resolving the directory and
 * refusing a path that escapes it all live in `apps/local`, which is where the
 * machine is. What this service guarantees is the ordering — the same
 * fractional-index keys `BeatOperationsService` uses, so a Clip Mockup can be
 * repositioned by the same `--before`/`--after` anchoring.
 */

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createClipMockupOperations = (db: Database) => {
  /**
   * Non-archived Clip Mockups of a Video, sorted by their fractional `order`
   * key — i.e. the Video's Animatic, in playback order.
   */
  const listClipMockupsByVideoId = (videoId: string) =>
    makeDbCall(() =>
      db.query.clipMockups.findMany({
        where: and(
          eq(clipMockups.videoId, videoId),
          eq(clipMockups.archived, false)
        ),
        orderBy: asc(clipMockups.order),
      })
    );

  const requireClipMockup = (id: string) =>
    Effect.gen(function* () {
      const row = yield* makeDbCall(() =>
        db.query.clipMockups.findFirst({ where: eq(clipMockups.id, id) })
      );
      if (!row) {
        return yield* new NotFoundError({ type: "clipMockup", params: { id } });
      }
      return row;
    });

  /**
   * Create a Clip Mockup in a Video's Animatic. `line` and `imagePath` are
   * both required — a Clip Mockup with no picture or no words is not a thing,
   * and that constraint is the point of the feature. `beforeClipMockupId`
   * anchors the new row immediately before that one; `null`/absent appends to
   * the end. Mirrors {@link createBeat}'s fractional-key positioning exactly.
   *
   * `durationSeconds` is left null: it is the measured length of the line's
   * speech, and speech synthesis is a later change.
   */
  const createClipMockup = Effect.fn("createClipMockup")(function* (
    videoId: string,
    line: string,
    imagePath: string,
    beforeClipMockupId: string | null = null
  ) {
    const existing = yield* listClipMockupsByVideoId(videoId);

    let prevOrder: string | null;
    let nextOrder: string | null;
    if (beforeClipMockupId === null) {
      prevOrder = existing.at(-1)?.order ?? null;
      nextOrder = null;
    } else {
      const idx = existing.findIndex((r) => r.id === beforeClipMockupId);
      if (idx === -1) {
        return yield* new NotFoundError({
          type: "clipMockup",
          params: { id: beforeClipMockupId },
        });
      }
      prevOrder = existing[idx - 1]?.order ?? null;
      nextOrder = existing[idx]!.order;
    }

    const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

    const [row] = yield* makeDbCall(() =>
      db
        .insert(clipMockups)
        .values({ videoId, line, imagePath, order: order! })
        .returning()
    );

    if (!row) {
      return yield* new UnknownDBServiceError({
        cause: "No clip mockup was returned from the database",
      });
    }

    return row;
  });

  /**
   * Replace a Clip Mockup's spoken line. `durationSeconds` is deliberately
   * left alone here: it is the MEASURED length of the line's speech, so only
   * whatever synthesises that speech may write it, and a caller that changes
   * the words without re-synthesising must be able to see that the duration
   * has gone stale rather than have it silently zeroed.
   */
  const setClipMockupLine = Effect.fn("setClipMockupLine")(function* (
    id: string,
    line: string
  ) {
    yield* makeDbCall(() =>
      db.update(clipMockups).set({ line }).where(eq(clipMockups.id, id))
    );
    return yield* requireClipMockup(id);
  });

  /**
   * Point a Clip Mockup at a different frame. `imagePath` is relative to
   * `{CLIP_MOCKUP_DIR}/{lineageId}/`, and this service never checks that
   * anything is there — the caller that owns the disk writes the PNG first and
   * only then swaps the path. The old frame is left where it is: the row is
   * the state, and an orphan PNG costs nothing.
   */
  const setClipMockupImagePath = Effect.fn("setClipMockupImagePath")(function* (
    id: string,
    imagePath: string
  ) {
    yield* makeDbCall(() =>
      db.update(clipMockups).set({ imagePath }).where(eq(clipMockups.id, id))
    );
    return yield* requireClipMockup(id);
  });

  /**
   * Reposition a Clip Mockup WITHIN its own Video, computing a fractional key
   * strictly between its new neighbours. `beforeClipMockupId === null` moves
   * it to the end. The same shape as {@link moveBeat} minus the target Video:
   * a Clip Mockup's frame lives under its Video's `lineageId`, so carrying a
   * row into another Video would leave its picture behind. Reordering touches
   * `order` and nothing else — no file is read or written.
   */
  const moveClipMockup = Effect.fn("moveClipMockup")(function* (
    id: string,
    beforeClipMockupId: string | null
  ) {
    const row = yield* requireClipMockup(id);

    // The Video's Animatic as it would look without the moved row.
    const existing = yield* listClipMockupsByVideoId(row.videoId);
    const remaining = existing.filter((r) => r.id !== id);

    let prevOrder: string | null;
    let nextOrder: string | null;
    if (beforeClipMockupId === null) {
      prevOrder = remaining.at(-1)?.order ?? null;
      nextOrder = null;
    } else {
      const idx = remaining.findIndex((r) => r.id === beforeClipMockupId);
      if (idx === -1) {
        return yield* new NotFoundError({
          type: "clipMockup",
          params: { id: beforeClipMockupId },
        });
      }
      prevOrder = remaining[idx - 1]?.order ?? null;
      nextOrder = remaining[idx]!.order;
    }

    const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

    yield* makeDbCall(() =>
      db
        .update(clipMockups)
        .set({ order: order! })
        .where(eq(clipMockups.id, id))
    );

    return yield* requireClipMockup(id);
  });

  /**
   * Archive a Clip Mockup. As with a Beat, archived == deleted: it leaves the
   * Animatic and there is no restore verb. The PNG on disk is deliberately
   * left alone — the row is the state, and an orphan frame costs nothing.
   */
  const deleteClipMockup = Effect.fn("deleteClipMockup")(function* (
    id: string
  ) {
    yield* makeDbCall(() =>
      db
        .update(clipMockups)
        .set({ archived: true })
        .where(eq(clipMockups.id, id))
    );
    return { success: true as const };
  });

  return {
    listClipMockupsByVideoId,
    getClipMockupById: requireClipMockup,
    createClipMockup,
    setClipMockupLine,
    setClipMockupImagePath,
    moveClipMockup,
    deleteClipMockup,
  };
};

export class ClipMockupOperationsService extends Effect.Service<ClipMockupOperationsService>()(
  "ClipMockupOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createClipMockupOperations(db);
    }),
  }
) {}
