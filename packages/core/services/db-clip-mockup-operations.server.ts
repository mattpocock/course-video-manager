import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { clipMockups } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { orderKeyBeforeItem } from "../lib/sort-by-order.js";
import { listAnimaticOrder } from "./db-animatic-order.server.js";

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
 *
 * THE ORDER SPACE IS SHARED with Clip Mockup Chapters, the dividers that group
 * an Animatic. So `createClipMockup` and `moveClipMockup` compute their keys
 * against `listAnimaticOrder` — the merged, sorted list of both nouns — not
 * against this table. Their external behaviour is the same (append to the end,
 * or before a named row), but appending now lands INSIDE the last divider.
 */

/**
 * The measured voicing of a Clip Mockup's line: where the WAV landed
 * (relative to `{CLIP_MOCKUP_DIR}/{video.lineageId}/`, like `imagePath`) and
 * how many seconds it runs. A FLOAT — the whole Animatic's run time is the sum
 * of these, and rounding each one drifts by minutes over a Lesson.
 */
export interface ClipMockupSpeech {
  readonly audioPath: string;
  readonly durationSeconds: number;
}

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
   * Create a Clip Mockup in a Video's Animatic. `line`, `imagePath` and
   * `speech` are all required — a Clip Mockup with no picture, no words or no
   * voicing is not a thing, and that constraint is the point of the feature.
   * `beforeClipMockupId` anchors the new row immediately before that one;
   * `null`/absent appends to the end. Mirrors {@link createBeat}'s
   * fractional-key positioning exactly.
   *
   * `speech` arrives already MEASURED and already on disk. This service never
   * synthesises anything and never opens a file: the caller that owns the
   * machine speaks the line, writes the WAV and hands over the two facts the
   * row keeps — where it landed, and how long it runs.
   */
  const createClipMockup = Effect.fn("createClipMockup")(function* (
    videoId: string,
    line: string,
    imagePath: string,
    speech: ClipMockupSpeech,
    beforeClipMockupId: string | null = null
  ) {
    // THE MERGED SPACE, not this table alone: a Clip Mockup Chapter holds a
    // position in the same order key space, so appending must land INSIDE the
    // last divider rather than after it.
    const items = yield* listAnimaticOrder(db, videoId);
    const order = orderKeyBeforeItem(items, beforeClipMockupId);
    if (order === null) {
      return yield* new NotFoundError({
        type: "clipMockup",
        params: { id: beforeClipMockupId },
      });
    }

    const [row] = yield* makeDbCall(() =>
      db
        .insert(clipMockups)
        .values({
          videoId,
          line,
          imagePath,
          audioPath: speech.audioPath,
          durationSeconds: speech.durationSeconds,
          order,
        })
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
   * Replace a Clip Mockup's spoken line TOGETHER WITH its speech. The words
   * and their voicing move as one write on purpose: `durationSeconds` is the
   * measured length of THIS line, and a row whose words say one thing while
   * its duration measures another would make an Animatic's run-time estimate
   * quietly wrong. The caller re-synthesises before it calls here.
   */
  const setClipMockupLine = Effect.fn("setClipMockupLine")(function* (
    id: string,
    line: string,
    speech: ClipMockupSpeech
  ) {
    yield* makeDbCall(() =>
      db
        .update(clipMockups)
        .set({
          line,
          audioPath: speech.audioPath,
          durationSeconds: speech.durationSeconds,
        })
        .where(eq(clipMockups.id, id))
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

    // The Video's Animatic — BOTH kinds of row — as it would look without the
    // moved one.
    const remaining = (yield* listAnimaticOrder(db, row.videoId)).filter(
      (item) => item.id !== id
    );
    const order = orderKeyBeforeItem(remaining, beforeClipMockupId);
    if (order === null) {
      return yield* new NotFoundError({
        type: "clipMockup",
        params: { id: beforeClipMockupId },
      });
    }

    yield* makeDbCall(() =>
      db.update(clipMockups).set({ order }).where(eq(clipMockups.id, id))
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
