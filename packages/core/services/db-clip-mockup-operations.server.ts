import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { clipMockupChapters, clipMockups } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import { orderKeyBeforeItem } from "../lib/sort-by-order.js";
import { listAnimaticOrder, lockAnimatic } from "./db-animatic-order.server.js";
import { transactionalizeWrites } from "./with-db-transaction.server.js";

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
 * an Animatic. So `createClipMockups` and `moveClipMockup` compute their keys
 * against `listAnimaticOrder` — the merged, sorted list of both nouns — not
 * against this table, and under `lockAnimatic`, so two writers on one Video
 * can never compute the same key.
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

/** One row of a `createClipMockups` run: a moment, or a divider between moments. */
export type ClipMockupBatchEntry =
  | {
      readonly type: "clipMockup";
      readonly line: string;
      readonly imagePath: string;
      readonly speech: ClipMockupSpeech;
    }
  | { readonly type: "clipMockupChapter"; readonly name: string };

/** One `updateClipMockups` edit. Anything left out is left as it is. */
export interface ClipMockupEdit {
  readonly id: string;
  readonly imagePath?: string;
  readonly say?: { readonly line: string; readonly speech: ClipMockupSpeech };
}

type ClipMockupRow = typeof clipMockups.$inferSelect;
type ClipMockupChapterRow = typeof clipMockupChapters.$inferSelect;

/** A created row, tagged with its noun — the `type` `list --with-chapters` uses. */
export type CreatedAnimaticRow =
  | ({ readonly type: "clipMockup" } & ClipMockupRow)
  | ({ readonly type: "clipMockupChapter" } & ClipMockupChapterRow);

const noRowReturned = (noun: string) =>
  new UnknownDBServiceError({
    cause: `No ${noun} was returned from the database`,
  });

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

  /**
   * The speech durations of every non-archived Clip Mockup across several
   * Videos, in one read — what the Animatic's Section clock sums. Only the two
   * columns it needs: a Section's worth of full rows is of no use to it.
   */
  const listClipMockupDurationsByVideoIds = (videoIds: readonly string[]) =>
    videoIds.length === 0
      ? Effect.succeed([] as { videoId: string; durationSeconds: number }[])
      : makeDbCall(() =>
          db.query.clipMockups.findMany({
            columns: { videoId: true, durationSeconds: true },
            where: and(
              inArray(clipMockups.videoId, [...videoIds]),
              eq(clipMockups.archived, false)
            ),
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
   * Add a run of rows to the END of a Video's Animatic, in the order given —
   * Clip Mockups, and the Clip Mockup Chapters that divide them, in one list.
   *
   * THE ONE WAY A CLIP MOCKUP IS CREATED, and it takes many on purpose.
   * Voicing a line and capturing a frame are expensive, so the CLI does a
   * Video's worth at once, and the rows land in ONE transaction: all of them,
   * or none. The keys are made in one step, between the current last row and
   * the end, so the file order IS the Animatic order.
   *
   * A Chapter entry is here because the two nouns share one order space: a
   * divider named between two moments of the same run needs a key between
   * theirs, and only this write knows them.
   *
   * `lockAnimatic` first. Without it, two runs appended to the same Video at
   * the same time read the same last row and made the same keys.
   *
   * `speech` arrives already MEASURED and already on disk. This service never
   * synthesises anything and never opens a file: the caller that owns the
   * machine speaks the line, writes the WAV and hands over the two facts the
   * row keeps — where it landed, and how long it runs.
   */
  const createClipMockups = Effect.fn("createClipMockups")(function* (
    videoId: string,
    entries: ReadonlyArray<ClipMockupBatchEntry>
  ) {
    yield* lockAnimatic(db, videoId);
    // THE MERGED SPACE, not this table alone: a Clip Mockup Chapter holds a
    // position in the same order key space, so appending must land INSIDE the
    // last divider rather than after it.
    const items = yield* listAnimaticOrder(db, videoId);
    const keys = generateNKeysBetween(
      items.at(-1)?.order ?? null,
      null,
      entries.length
    );

    const created: CreatedAnimaticRow[] = [];
    for (const [i, entry] of entries.entries()) {
      const order = keys[i]!;
      if (entry.type === "clipMockupChapter") {
        const [row] = yield* makeDbCall(() =>
          db
            .insert(clipMockupChapters)
            .values({ videoId, name: entry.name, order, archived: false })
            .returning()
        );
        if (!row) return yield* noRowReturned("clip mockup chapter");
        created.push({ type: "clipMockupChapter", ...row });
        continue;
      }
      const [row] = yield* makeDbCall(() =>
        db
          .insert(clipMockups)
          .values({
            videoId,
            line: entry.line,
            imagePath: entry.imagePath,
            audioPath: entry.speech.audioPath,
            durationSeconds: entry.speech.durationSeconds,
            order,
          })
          .returning()
      );
      if (!row) return yield* noRowReturned("clip mockup");
      created.push({ type: "clipMockup", ...row });
    }
    return created;
  });

  /**
   * Change the line, the frame, or both, of several Clip Mockups in ONE
   * transaction — all of the edits, or none. The rows may belong to different
   * Videos: a round of notes on a Section is one call.
   *
   * New WORDS travel WITH their speech (`say`): `durationSeconds` is the
   * measured length of THIS line, and a row whose words say one thing while its
   * duration measures another would make an Animatic's run-time estimate
   * quietly wrong. A new frame is only a new `imagePath` — the caller that owns
   * the disk writes the PNG first, and the old one is left where it is, because
   * an orphan PNG costs nothing.
   *
   * No order key changes here, so no Animatic is locked.
   */
  const updateClipMockups = Effect.fn("updateClipMockups")(function* (
    edits: ReadonlyArray<ClipMockupEdit>
  ) {
    const updated = [];
    for (const edit of edits) {
      const current = yield* requireClipMockup(edit.id);
      if (current.archived) {
        return yield* new NotFoundError({
          type: "clipMockup",
          params: { id: edit.id },
        });
      }
      yield* makeDbCall(() =>
        db
          .update(clipMockups)
          .set({
            ...(edit.imagePath === undefined
              ? {}
              : { imagePath: edit.imagePath }),
            ...(edit.say === undefined
              ? {}
              : {
                  line: edit.say.line,
                  audioPath: edit.say.speech.audioPath,
                  durationSeconds: edit.say.speech.durationSeconds,
                }),
          })
          .where(eq(clipMockups.id, edit.id))
      );
      updated.push(yield* requireClipMockup(edit.id));
    }
    return updated;
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
    yield* lockAnimatic(db, row.videoId);

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
    listClipMockupDurationsByVideoIds,
    getClipMockupById: requireClipMockup,
    createClipMockups,
    updateClipMockups,
    moveClipMockup,
    deleteClipMockup,
  };
};

export class ClipMockupOperationsService extends Effect.Service<ClipMockupOperationsService>()(
  "ClipMockupOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      // One transaction per call: a batch lands whole or not at all, and the
      // Animatic lock is held until the keys it protects are committed.
      return transactionalizeWrites(db, createClipMockupOperations, [
        "createClipMockups",
        "updateClipMockups",
        "moveClipMockup",
      ]);
    }),
  }
) {}
