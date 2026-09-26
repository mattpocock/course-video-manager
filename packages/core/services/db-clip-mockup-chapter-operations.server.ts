import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { clipMockupChapters } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { orderKeyBeforeItem } from "../lib/sort-by-order.js";
import { listAnimaticOrder } from "./db-animatic-order.server.js";

/**
 * Row-level operations for Clip Mockup Chapters — the named dividers that group
 * a Video's Clip Mockups in its Animatic.
 *
 * ONE SHARED ORDER SPACE, and it is the whole design. A divider's `order` is a
 * fractional index in the same key space as `clip_mockup.order`, so every
 * position here is computed against {@link listAnimaticOrder} — the merged,
 * sorted list of both kinds of row — and never against this table alone. That
 * is what makes membership implicit: a Clip Mockup belongs to the last divider
 * above it, so archiving a divider absorbs its rows upward with no write, and
 * moving a row can never leave a stale parent behind.
 *
 * NO DRAFT GUARD, AND THAT IS A BUG (owed work, not a design). Every write here
 * should call `requireDraftVersionForVideo`, as `ClipOperationsService`'s
 * chapter writes do. Without it a stranded write goes straight through, and it
 * has: 57 Chapters and 190 Clip Mockups landed on a published Version, where
 * nothing reads them. `ClipMockupOperationsService` owes the same guard. The
 * write-closure reasoning this omission rested on, and why it was wrong, is in
 * CODING_STANDARDS.md under "A write to anything a Version owns goes through
 * the Draft guard".
 *
 * ONE DELIBERATE ASYMMETRY with the Chapters that group filmed Clips:
 *
 *   NO DISK. Like the Clip Mockup service this touches no file, so nothing here
 *   is local-only: a divider is a row, while a frame and a WAV are a directory
 *   on the author's machine.
 *
 * Archived rows are excluded from every read and there is no restore verb, the
 * same one-way convention as a Beat and a Clip Mockup.
 */

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createClipMockupChapterOperations = (db: Database) => {
  /**
   * Active Clip Mockup Chapters of a Video, in Animatic order — backs
   * `cvm clip-mockup-chapter list`.
   */
  const listClipMockupChaptersByVideoId = (videoId: string) =>
    makeDbCall(() =>
      db.query.clipMockupChapters.findMany({
        where: and(
          eq(clipMockupChapters.videoId, videoId),
          eq(clipMockupChapters.archived, false)
        ),
        orderBy: asc(clipMockupChapters.order),
      })
    );

  /**
   * Rows for these ids in ANY archived state, in no guaranteed order. The CLI
   * turns an archived row into a not-found itself — this read is also how a
   * write verb echoes the row it just archived.
   */
  const getClipMockupChaptersByIds = (ids: ReadonlyArray<string>) =>
    makeDbCall(() =>
      db.query.clipMockupChapters.findMany({
        where: inArray(clipMockupChapters.id, [...ids]),
      })
    );

  const requireClipMockupChapter = (id: string) =>
    Effect.gen(function* () {
      const row = yield* makeDbCall(() =>
        db.query.clipMockupChapters.findFirst({
          where: eq(clipMockupChapters.id, id),
        })
      );
      if (!row) {
        return yield* new NotFoundError({
          type: "clipMockupChapter",
          params: { id },
        });
      }
      return row;
    });

  /**
   * The merged read, exposed on this service so the CLI and the Animatic page
   * can reach it over the one HTTP transport. See
   * `db-animatic-order.server.ts` for why there is exactly one of these.
   */
  const listAnimaticOrderForVideo = (videoId: string) =>
    listAnimaticOrder(db, videoId);

  /**
   * Open a Clip Mockup Chapter in a Video's Animatic, anchored immediately
   * before `beforeItemId` — which may be a Clip Mockup id OR another divider's
   * id, because the two share one order space. `null` appends to the end.
   */
  const createClipMockupChapterAtItem = Effect.fn(
    "createClipMockupChapterAtItem"
  )(function* (videoId: string, name: string, beforeItemId: string | null) {
    const items = yield* listAnimaticOrder(db, videoId);
    const order = orderKeyBeforeItem(items, beforeItemId);
    if (order === null) {
      return yield* new NotFoundError({
        type: "createClipMockupChapterAtItem",
        params: { videoId, beforeItemId },
      });
    }

    const [row] = yield* makeDbCall(() =>
      db
        .insert(clipMockupChapters)
        .values({ videoId, name, order, archived: false })
        .returning()
    );
    if (!row) {
      return yield* new UnknownDBServiceError({
        cause: "No clip mockup chapter was returned from the database",
      });
    }
    return row;
  });

  /** Rename a Clip Mockup Chapter. A title is all there is to change. */
  const updateClipMockupChapter = Effect.fn("updateClipMockupChapter")(
    function* (id: string, values: { readonly name: string }) {
      yield* makeDbCall(() =>
        db
          .update(clipMockupChapters)
          .set({ name: values.name })
          .where(eq(clipMockupChapters.id, id))
      );
      return yield* requireClipMockupChapter(id);
    }
  );

  /**
   * Slide a divider to a new point in the Animatic, anchored immediately before
   * `beforeItemId` (a Clip Mockup id or another divider's id); `null` moves it
   * to the end. The moved row is filtered out of the merged list first, so it
   * can never anchor to itself.
   */
  const moveClipMockupChapterToPosition = Effect.fn(
    "moveClipMockupChapterToPosition"
  )(function* (id: string, beforeItemId: string | null) {
    const chapter = yield* requireClipMockupChapter(id);
    const items = (yield* listAnimaticOrder(db, chapter.videoId)).filter(
      (item) => item.id !== id
    );
    const order = orderKeyBeforeItem(items, beforeItemId);
    if (order === null) {
      return yield* new NotFoundError({
        type: "moveClipMockupChapterToPosition",
        params: { clipMockupChapterId: beforeItemId },
      });
    }

    yield* makeDbCall(() =>
      db
        .update(clipMockupChapters)
        .set({ order })
        .where(eq(clipMockupChapters.id, id))
    );
    return yield* requireClipMockupChapter(id);
  });

  /**
   * Archive a divider. It touches NOTHING else: its Clip Mockups are absorbed
   * into the Chapter above by the implicit-membership rule, with no write, so
   * an organisational verb can never destroy hours of frames and speech.
   */
  const archiveClipMockupChapter = Effect.fn("archiveClipMockupChapter")(
    function* (id: string) {
      yield* makeDbCall(() =>
        db
          .update(clipMockupChapters)
          .set({ archived: true })
          .where(eq(clipMockupChapters.id, id))
      );
      return { success: true as const };
    }
  );

  return {
    listAnimaticOrder: listAnimaticOrderForVideo,
    listClipMockupChaptersByVideoId,
    getClipMockupChaptersByIds,
    getClipMockupChapterById: requireClipMockupChapter,
    createClipMockupChapterAtItem,
    updateClipMockupChapter,
    moveClipMockupChapterToPosition,
    archiveClipMockupChapter,
  };
};

export class ClipMockupChapterOperationsService extends Effect.Service<ClipMockupChapterOperationsService>()(
  "ClipMockupChapterOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createClipMockupChapterOperations(db);
    }),
  }
) {}
