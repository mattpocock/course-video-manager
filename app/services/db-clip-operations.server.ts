import type { DrizzleDB } from "@/services/drizzle-service.server";
import { clips, chapters } from "@/db/schema";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import { compareOrderStrings } from "@/lib/sort-by-order";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createClipOperations = (db: DrizzleDB) => {
  const getClipById = Effect.fn("getClipById")(function* (clipId: string) {
    const clip = yield* makeDbCall(() =>
      db.query.clips.findFirst({
        where: eq(clips.id, clipId),
      })
    );

    if (!clip) {
      return yield* new NotFoundError({
        type: "getClipById",
        params: { clipId },
      });
    }

    return clip;
  });

  const getClipsByIds = Effect.fn("getClipsByIds")(function* (
    clipIds: readonly string[]
  ) {
    const foundClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: inArray(clips.id, clipIds),
      })
    );

    return foundClips;
  });

  const updateClip = Effect.fn("updateClip")(function* (
    clipId: string,
    updatedClip: {
      text?: string;
      scene?: string;
      profile?: string;
      transcribedAt?: Date;
      beatType?: string;
    }
  ) {
    const [clip] = yield* makeDbCall(() =>
      db.update(clips).set(updatedClip).where(eq(clips.id, clipId)).returning()
    );

    return clip!;
  });

  const archiveClip = Effect.fn("archiveClip")(function* (clipId: string) {
    const clipExists = yield* makeDbCall(() =>
      db.query.clips.findFirst({
        where: eq(clips.id, clipId),
      })
    );

    if (!clipExists) {
      return yield* new NotFoundError({
        type: "archiveClip",
        params: { clipId },
      });
    }

    const clip = yield* makeDbCall(() =>
      db.update(clips).set({ archived: true }).where(eq(clips.id, clipId))
    );

    return clip;
  });

  const reorderClip = Effect.fn("reorderClip")(function* (
    clipId: string,
    direction: "up" | "down"
  ) {
    // First, get the clip to know what video we're working with
    const clip = yield* makeDbCall(() =>
      db.query.clips.findFirst({
        where: eq(clips.id, clipId),
      })
    );

    if (!clip) {
      return yield* new NotFoundError({
        type: "reorderClip",
        params: { clipId },
      });
    }

    // Get all non-archived clips and chapters for this video
    // We need both because clips and chapters share the same ordering space
    const allClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: and(eq(clips.videoId, clip.videoId), eq(clips.archived, false)),
        orderBy: asc(clips.order),
      })
    );

    const allChapters = yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: and(
          eq(chapters.videoId, clip.videoId),
          eq(chapters.archived, false)
        ),
        orderBy: asc(chapters.order),
      })
    );

    // Combine and sort by order - clips and chapters share the same ordering space
    const allItems = [
      ...allClips.map((c) => ({ type: "clip" as const, ...c })),
      ...allChapters.map((cs) => ({
        type: "chapter" as const,
        ...cs,
      })),
    ].sort((a, b) => compareOrderStrings(a.order, b.order));

    const itemIndex = allItems.findIndex(
      (item) => item.type === "clip" && item.id === clipId
    );
    const targetIndex = direction === "up" ? itemIndex - 1 : itemIndex + 1;

    // Check boundaries
    if (targetIndex < 0 || targetIndex >= allItems.length) {
      return { success: false, reason: "boundary" };
    }

    // Calculate new order based on neighbors in the combined list
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
      db.update(clips).set({ order: newOrder }).where(eq(clips.id, clipId))
    );

    return { success: true };
  });

  const createChapter = Effect.fn("createChapter")(function* (
    videoId: string,
    name: string,
    order: string
  ) {
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

  const appendClips = Effect.fn("addClips")(function* (opts: {
    videoId: string;
    insertionPoint:
      | { type: "start" }
      | { type: "after-clip"; databaseClipId: string }
      | { type: "after-chapter"; chapterId: string };
    clips: readonly {
      inputVideo: string;
      startTime: number;
      endTime: number;
    }[];
  }) {
    const { videoId, insertionPoint, clips: inputClips } = opts;
    let prevOrder: string | null | undefined = null;
    let nextOrder: string | null | undefined = null;

    // Get all non-archived clips and chapters for this video
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

    // Combine and sort by order to get correct insertion position
    const allItems = [
      ...allClips.map((c) => ({ type: "clip" as const, ...c })),
      ...allChapters.map((cs) => ({
        type: "chapter" as const,
        ...cs,
      })),
    ].sort((a, b) => compareOrderStrings(a.order, b.order));

    if (insertionPoint.type === "start") {
      // Insert before all items
      prevOrder = null;
      const firstItem = allItems[0];
      nextOrder = firstItem?.order;
    } else if (insertionPoint.type === "after-clip") {
      // Insert after specific clip, but before any section that follows it
      const insertAfterClipIndex = allItems.findIndex(
        (item) =>
          item.type === "clip" && item.id === insertionPoint.databaseClipId
      );

      if (insertAfterClipIndex === -1) {
        return yield* new NotFoundError({
          type: "appendClips",
          params: { videoId, insertionPoint },
          message: `Could not find a clip to insert after`,
        });
      }

      const insertAfterItem = allItems[insertAfterClipIndex];
      prevOrder = insertAfterItem?.order;

      // Get the next item (could be a clip OR a section)
      const nextItem = allItems[insertAfterClipIndex + 1];
      nextOrder = nextItem?.order;
    } else if (insertionPoint.type === "after-chapter") {
      // Insert after specific chapter
      const insertAfterSectionIndex = allItems.findIndex(
        (item) =>
          item.type === "chapter" && item.id === insertionPoint.chapterId
      );

      if (insertAfterSectionIndex === -1) {
        return yield* new NotFoundError({
          type: "appendClips",
          params: { videoId, insertionPoint },
          message: `Could not find a chapter to insert after`,
        });
      }

      const insertAfterItem = allItems[insertAfterSectionIndex];
      prevOrder = insertAfterItem?.order;

      const nextItem = allItems[insertAfterSectionIndex + 1];
      nextOrder = nextItem?.order;
    }

    const orders = generateNKeysBetween(
      prevOrder ?? null,
      nextOrder ?? null,
      inputClips.length
    );

    const clipsResult = yield* makeDbCall(() =>
      db
        .insert(clips)
        .values(
          inputClips.map((clip, index) => ({
            ...clip,
            videoId,
            videoFilename: clip.inputVideo,
            sourceStartTime: clip.startTime,
            sourceEndTime: clip.endTime,
            order: orders[index]!,
            archived: false,
            text: "",
          }))
        )
        .returning()
    );

    return clipsResult;
  });

  return {
    getClipById,
    getClipsByIds,
    updateClip,
    archiveClip,
    reorderClip,
    createChapter,
    createChapterAtInsertionPoint,
    createChapterAtPosition,
    getChapterById,
    updateChapter,
    archiveChapter,
    reorderChapter,
    appendClips,
  };
};
