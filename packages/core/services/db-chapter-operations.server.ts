import type { Database } from "./drizzle-service.server.js";
import { clips, chapters } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import {
  requireDraftVersionForChapter,
  requireDraftVersionForVideo,
} from "./draft-guard.server.js";
import {
  compareOrderStrings,
  orderKeyBeforeItem,
} from "../lib/sort-by-order.js";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/**
 * Chapter write/read operations. Split out of db-clip-operations.server.ts
 * purely to stay under the repo's per-file token budget: Chapters and Clips
 * share one fractional order space (see `app/cli/commands/clip.ts`
 * docstring), so every positioning op here still reads both tables to
 * compute a merged timeline view, but none of these functions call INTO the
 * Clip-specific ops, so the split has no behavioral seam. Merged back into
 * `ClipOperationsService`'s single surface by db-clip-operations.server.ts —
 * every existing caller keeps going through that one service.
 */
export const createChapterOperationsUnwrapped = (db: Database) => {
  const createChapter = Effect.fn("createChapter")(function* (
    videoId: string,
    name: string,
    order: string
  ) {
    yield* requireDraftVersionForVideo(db, videoId);
    const [chapter] = yield* makeDbCall(() =>
      db
        .insert(chapters)
        .values({
          videoId,
          name,
          order,
          archived: false,
        })
        .returning()
    );

    if (!chapter) {
      return yield* new UnknownDBServiceError({
        cause: "No chapter was returned from the database",
      });
    }

    return chapter;
  });

  const createChapterAtInsertionPoint = Effect.fn(
    "createChapterAtInsertionPoint"
  )(function* (
    videoId: string,
    name: string,
    insertionPoint:
      | { type: "start" }
      | { type: "after-clip"; databaseClipId: string }
      | { type: "after-chapter"; chapterId: string }
  ) {
    yield* requireDraftVersionForVideo(db, videoId);
    // Get all non-archived clips and chapters for this video, ordered
    const allClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
        orderBy: asc(clips.order),
      })
    );

    const allChapters = yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: and(eq(chapters.videoId, videoId), eq(chapters.archived, false)),
        orderBy: asc(chapters.order),
      })
    );

    // Combine and sort by order
    const allItems = [
      ...allClips.map((c) => ({ type: "clip" as const, ...c })),
      ...allChapters.map((cs) => ({
        type: "chapter" as const,
        ...cs,
      })),
    ].sort((a, b) => compareOrderStrings(a.order, b.order));

    // Calculate order based on insertion point
    let prevOrder: string | null = null;
    let nextOrder: string | null = null;

    if (insertionPoint.type === "start") {
      // Insert before all items
      const firstItem = allItems[0];
      nextOrder = firstItem?.order ?? null;
    } else if (insertionPoint.type === "after-clip") {
      // Insert after specific clip
      const insertAfterClipIndex = allItems.findIndex(
        (item) =>
          item.type === "clip" && item.id === insertionPoint.databaseClipId
      );

      if (insertAfterClipIndex === -1) {
        return yield* new NotFoundError({
          type: "createChapterAtInsertionPoint",
          params: { videoId, insertionPoint },
          message: `Could not find a clip to insert after`,
        });
      }

      const insertAfterItem = allItems[insertAfterClipIndex];
      prevOrder = insertAfterItem?.order ?? null;

      const nextItem = allItems[insertAfterClipIndex + 1];
      nextOrder = nextItem?.order ?? null;
    } else if (insertionPoint.type === "after-chapter") {
      // Insert after specific chapter
      const insertAfterSectionIndex = allItems.findIndex(
        (item) =>
          item.type === "chapter" && item.id === insertionPoint.chapterId
      );

      if (insertAfterSectionIndex === -1) {
        return yield* new NotFoundError({
          type: "createChapterAtInsertionPoint",
          params: { videoId, insertionPoint },
          message: `Could not find a chapter to insert after`,
        });
      }

      const insertAfterItem = allItems[insertAfterSectionIndex];
      prevOrder = insertAfterItem?.order ?? null;

      const nextItem = allItems[insertAfterSectionIndex + 1];
      nextOrder = nextItem?.order ?? null;
    }

    const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

    const [chapter] = yield* makeDbCall(() =>
      db
        .insert(chapters)
        .values({
          videoId,
          name,
          order: order!,
          archived: false,
        })
        .returning()
    );

    if (!chapter) {
      return yield* new UnknownDBServiceError({
        cause: "No chapter was returned from the database",
      });
    }

    return chapter;
  });

  const createChapterAtPosition = Effect.fn("createChapterAtPosition")(
    function* (
      videoId: string,
      name: string,
      position: "before" | "after",
      targetItemId: string,
      targetItemType: "clip" | "chapter"
    ) {
      yield* requireDraftVersionForVideo(db, videoId);
      // Get all non-archived clips and chapters for this video, ordered
      const allClips = yield* makeDbCall(() =>
        db.query.clips.findMany({
          where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
          orderBy: asc(clips.order),
        })
      );

      const allChapters = yield* makeDbCall(() =>
        db.query.chapters.findMany({
          where: and(
            eq(chapters.videoId, videoId),
            eq(chapters.archived, false)
          ),
          orderBy: asc(chapters.order),
        })
      );

      // Combine and sort by order
      const allItems = [
        ...allClips.map((c) => ({ type: "clip" as const, ...c })),
        ...allChapters.map((cs) => ({
          type: "chapter" as const,
          ...cs,
        })),
      ].sort((a, b) => compareOrderStrings(a.order, b.order));

      // Find the target item
      const targetIndex = allItems.findIndex(
        (item) => item.type === targetItemType && item.id === targetItemId
      );

      if (targetIndex === -1) {
        return yield* new NotFoundError({
          type: "createChapterAtPosition",
          params: { videoId, targetItemId, targetItemType },
          message: `Could not find the target ${targetItemType} to position relative to`,
        });
      }

      // Calculate order based on position
      let prevOrder: string | null = null;
      let nextOrder: string | null = null;

      if (position === "before") {
        // Insert before target item
        nextOrder = allItems[targetIndex]?.order ?? null;
        const prevItem = allItems[targetIndex - 1];
        prevOrder = prevItem?.order ?? null;
      } else {
        // Insert after target item
        prevOrder = allItems[targetIndex]?.order ?? null;
        const nextItem = allItems[targetIndex + 1];
        nextOrder = nextItem?.order ?? null;
      }

      const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

      const [chapter] = yield* makeDbCall(() =>
        db
          .insert(chapters)
          .values({
            videoId,
            name,
            order: order!,
            archived: false,
          })
          .returning()
      );

      if (!chapter) {
        return yield* new UnknownDBServiceError({
          cause: "No chapter was returned from the database",
        });
      }

      return chapter;
    }
  );

  const getChapterById = Effect.fn("getChapterById")(function* (
    chapterId: string
  ) {
    const chapter = yield* makeDbCall(() =>
      db.query.chapters.findFirst({
        where: eq(chapters.id, chapterId),
      })
    );

    if (!chapter) {
      return yield* new NotFoundError({
        type: "getChapterById",
        params: { chapterId },
      });
    }

    return chapter;
  });

  const updateChapter = Effect.fn("updateChapter")(function* (
    chapterId: string,
    updates: {
      name?: string;
    }
  ) {
    yield* requireDraftVersionForChapter(db, chapterId);
    const [chapter] = yield* makeDbCall(() =>
      db
        .update(chapters)
        .set(updates)
        .where(eq(chapters.id, chapterId))
        .returning()
    );

    if (!chapter) {
      return yield* new NotFoundError({
        type: "updateChapter",
        params: { chapterId },
      });
    }

    return chapter;
  });

  const archiveChapter = Effect.fn("archiveChapter")(function* (
    chapterId: string
  ) {
    yield* requireDraftVersionForChapter(db, chapterId);
    const chapterExists = yield* makeDbCall(() =>
      db.query.chapters.findFirst({
        where: eq(chapters.id, chapterId),
      })
    );

    if (!chapterExists) {
      return yield* new NotFoundError({
        type: "archiveChapter",
        params: { chapterId },
      });
    }

    yield* makeDbCall(() =>
      db
        .update(chapters)
        .set({ archived: true })
        .where(eq(chapters.id, chapterId))
    );

    return { success: true };
  });

  const reorderChapter = Effect.fn("reorderChapter")(function* (
    chapterId: string,
    direction: "up" | "down"
  ) {
    yield* requireDraftVersionForChapter(db, chapterId);
    // Get the chapter to know what video we're working with
    const chapter = yield* makeDbCall(() =>
      db.query.chapters.findFirst({
        where: eq(chapters.id, chapterId),
      })
    );

    if (!chapter) {
      return yield* new NotFoundError({
        type: "reorderChapter",
        params: { chapterId },
      });
    }

    // Get all non-archived clips and chapters for this video, ordered
    const allClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: and(
          eq(clips.videoId, chapter.videoId),
          eq(clips.archived, false)
        ),
        orderBy: asc(clips.order),
      })
    );

    const allChapters = yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: and(
          eq(chapters.videoId, chapter.videoId),
          eq(chapters.archived, false)
        ),
        orderBy: asc(chapters.order),
      })
    );

    // Combine and sort by order
    const allItems = [
      ...allClips.map((c) => ({ type: "clip" as const, ...c })),
      ...allChapters.map((cs) => ({
        type: "chapter" as const,
        ...cs,
      })),
    ].sort((a, b) => compareOrderStrings(a.order, b.order));

    const itemIndex = allItems.findIndex(
      (item) => item.type === "chapter" && item.id === chapterId
    );
    const targetIndex = direction === "up" ? itemIndex - 1 : itemIndex + 1;

    // Check boundaries
    if (targetIndex < 0 || targetIndex >= allItems.length) {
      return { success: false, reason: "boundary" };
    }

    // Calculate new order
    let newOrder: string;
    if (direction === "up") {
      const prevItem = allItems[targetIndex - 1];
      const nextItem = allItems[targetIndex];
      const prevOrder = prevItem?.order ?? null;
      const nextOrder = nextItem!.order;
      const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);
      newOrder = order!;
    } else {
      const prevItem = allItems[targetIndex];
      const nextItem = allItems[targetIndex + 1];
      const prevOrder = prevItem!.order;
      const nextOrder = nextItem?.order ?? null;
      const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);
      newOrder = order!;
    }

    yield* makeDbCall(() =>
      db
        .update(chapters)
        .set({ order: newOrder })
        .where(eq(chapters.id, chapterId))
    );

    return { success: true };
  });

  /**
   * Non-archived clips and chapters of a Video, merged and sorted by the shared
   * fractional `order` key — the same view db-clip-operations.server.ts builds,
   * assembled here too so `chapter add`/`chapter move` can position against both
   * without reaching back into the Clip ops (which would re-couple the split).
   */
  const mergedTimeline = Effect.fn("mergedTimeline")(function* (
    videoId: string
  ) {
    const allClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
        orderBy: asc(clips.order),
      })
    );
    const allChapters = yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: and(eq(chapters.videoId, videoId), eq(chapters.archived, false)),
        orderBy: asc(chapters.order),
      })
    );
    return [
      ...allClips.map((c) => ({
        type: "clip" as const,
        id: c.id,
        order: c.order,
      })),
      ...allChapters.map((c) => ({
        type: "chapter" as const,
        id: c.id,
        order: c.order,
      })),
    ].sort((a, b) => compareOrderStrings(a.order, b.order));
  });

  /** Active chapters of a Video, in timeline order — backs `chapter list`. */
  const listChaptersByVideoId = Effect.fn("listChaptersByVideoId")(function* (
    videoId: string
  ) {
    return yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: and(eq(chapters.videoId, videoId), eq(chapters.archived, false)),
        orderBy: asc(chapters.order),
      })
    );
  });

  /** Fetch chapters by id (any archived state) — backs `chapter get`. */
  const getChaptersByIds = Effect.fn("getChaptersByIds")(function* (
    chapterIds: readonly string[]
  ) {
    return yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: inArray(chapters.id, chapterIds),
      })
    );
  });

  /**
   * Create a Chapter positioned against the shared clip/chapter order space,
   * anchored immediately before `beforeItemId` (a Clip OR Chapter id) — `null`
   * appends to the end. The `cvm chapter add` primitive, symmetric with the
   * Clip ops' `createClip`; the UI's autofill keeps using
   * `createChapterAtInsertionPoint`/`createChapterAtPosition`.
   */
  const createChapterAtItem = Effect.fn("createChapterAtItem")(function* (
    videoId: string,
    name: string,
    beforeItemId: string | null
  ) {
    yield* requireDraftVersionForVideo(db, videoId);
    const items = yield* mergedTimeline(videoId);

    const order = orderKeyBeforeItem(items, beforeItemId);
    if (order === null) {
      return yield* new NotFoundError({
        type: "createChapterAtItem",
        params: { videoId, beforeItemId },
      });
    }

    const [chapter] = yield* makeDbCall(() =>
      db
        .insert(chapters)
        .values({ videoId, name, order, archived: false })
        .returning()
    );
    if (!chapter) {
      return yield* new UnknownDBServiceError({
        cause: "No chapter was returned from the database",
      });
    }
    return chapter;
  });

  /**
   * Reposition a Chapter to an explicit point in its Video's timeline, anchored
   * immediately before `beforeItemId` (a Clip OR Chapter id) — `null` appends to
   * the end. Mirrors the Clip ops' `moveClipToPosition`; `reorderChapter` is the
   * one-slot nudge, this is the jump-to-position the `chapter move` CLI needs.
   */
  const moveChapterToPosition = Effect.fn("moveChapterToPosition")(function* (
    chapterId: string,
    beforeItemId: string | null
  ) {
    yield* requireDraftVersionForChapter(db, chapterId);
    const chapter = yield* getChapterById(chapterId);

    const items = (yield* mergedTimeline(chapter.videoId)).filter(
      (item) => item.id !== chapterId
    );

    const order = orderKeyBeforeItem(items, beforeItemId);
    if (order === null) {
      return yield* new NotFoundError({
        type: "moveChapterToPosition",
        params: { chapterId: beforeItemId },
      });
    }

    yield* makeDbCall(() =>
      db.update(chapters).set({ order }).where(eq(chapters.id, chapterId))
    );

    return yield* getChapterById(chapterId);
  });

  return {
    createChapter,
    createChapterAtInsertionPoint,
    createChapterAtPosition,
    createChapterAtItem,
    getChapterById,
    getChaptersByIds,
    listChaptersByVideoId,
    updateChapter,
    archiveChapter,
    reorderChapter,
    moveChapterToPosition,
  };
};
