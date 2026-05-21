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

    // Get all non-archived clips and clip sections for this video
    // We need both because clips and clip sections share the same ordering space
    const allClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: and(eq(clips.videoId, clip.videoId), eq(clips.archived, false)),
        orderBy: asc(clips.order),
      })
    );

    const allClipSections = yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: and(
          eq(chapters.videoId, clip.videoId),
          eq(chapters.archived, false)
        ),
        orderBy: asc(chapters.order),
      })
    );

    // Combine and sort by order - clips and clip sections share the same ordering space
    const allItems = [
      ...allClips.map((c) => ({ type: "clip" as const, ...c })),
      ...allClipSections.map((cs) => ({
        type: "clip-section" as const,
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

  const createClipSection = Effect.fn("createClipSection")(function* (
    videoId: string,
    name: string,
    order: string
  ) {
    const [clipSection] = yield* makeDbCall(() =>
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

    if (!clipSection) {
      return yield* new UnknownDBServiceError({
        cause: "No clip section was returned from the database",
      });
    }

    return clipSection;
  });

  const createClipSectionAtInsertionPoint = Effect.fn(
    "createClipSectionAtInsertionPoint"
  )(function* (
    videoId: string,
    name: string,
    insertionPoint:
      | { type: "start" }
      | { type: "after-clip"; databaseClipId: string }
      | { type: "after-clip-section"; clipSectionId: string }
  ) {
    // Get all non-archived clips and clip sections for this video, ordered
    const allClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
        orderBy: asc(clips.order),
      })
    );

    const allClipSections = yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: and(eq(chapters.videoId, videoId), eq(chapters.archived, false)),
        orderBy: asc(chapters.order),
      })
    );

    // Combine and sort by order
    const allItems = [
      ...allClips.map((c) => ({ type: "clip" as const, ...c })),
      ...allClipSections.map((cs) => ({
        type: "clip-section" as const,
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
          type: "createClipSectionAtInsertionPoint",
          params: { videoId, insertionPoint },
          message: `Could not find a clip to insert after`,
        });
      }

      const insertAfterItem = allItems[insertAfterClipIndex];
      prevOrder = insertAfterItem?.order ?? null;

      const nextItem = allItems[insertAfterClipIndex + 1];
      nextOrder = nextItem?.order ?? null;
    } else if (insertionPoint.type === "after-clip-section") {
      // Insert after specific clip section
      const insertAfterSectionIndex = allItems.findIndex(
        (item) =>
          item.type === "clip-section" &&
          item.id === insertionPoint.clipSectionId
      );

      if (insertAfterSectionIndex === -1) {
        return yield* new NotFoundError({
          type: "createClipSectionAtInsertionPoint",
          params: { videoId, insertionPoint },
          message: `Could not find a clip section to insert after`,
        });
      }

      const insertAfterItem = allItems[insertAfterSectionIndex];
      prevOrder = insertAfterItem?.order ?? null;

      const nextItem = allItems[insertAfterSectionIndex + 1];
      nextOrder = nextItem?.order ?? null;
    }

    const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

    const [clipSection] = yield* makeDbCall(() =>
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

    if (!clipSection) {
      return yield* new UnknownDBServiceError({
        cause: "No clip section was returned from the database",
      });
    }

    return clipSection;
  });

  const createClipSectionAtPosition = Effect.fn("createClipSectionAtPosition")(
    function* (
      videoId: string,
      name: string,
      position: "before" | "after",
      targetItemId: string,
      targetItemType: "clip" | "clip-section"
    ) {
      // Get all non-archived clips and clip sections for this video, ordered
      const allClips = yield* makeDbCall(() =>
        db.query.clips.findMany({
          where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
          orderBy: asc(clips.order),
        })
      );

      const allClipSections = yield* makeDbCall(() =>
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
        ...allClipSections.map((cs) => ({
          type: "clip-section" as const,
          ...cs,
        })),
      ].sort((a, b) => compareOrderStrings(a.order, b.order));

      // Find the target item
      const targetIndex = allItems.findIndex(
        (item) => item.type === targetItemType && item.id === targetItemId
      );

      if (targetIndex === -1) {
        return yield* new NotFoundError({
          type: "createClipSectionAtPosition",
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

      const [clipSection] = yield* makeDbCall(() =>
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

      if (!clipSection) {
        return yield* new UnknownDBServiceError({
          cause: "No clip section was returned from the database",
        });
      }

      return clipSection;
    }
  );

  const getClipSectionById = Effect.fn("getClipSectionById")(function* (
    clipSectionId: string
  ) {
    const clipSection = yield* makeDbCall(() =>
      db.query.chapters.findFirst({
        where: eq(chapters.id, clipSectionId),
      })
    );

    if (!clipSection) {
      return yield* new NotFoundError({
        type: "getClipSectionById",
        params: { clipSectionId },
      });
    }

    return clipSection;
  });

  const updateClipSection = Effect.fn("updateClipSection")(function* (
    clipSectionId: string,
    updates: {
      name?: string;
    }
  ) {
    const [clipSection] = yield* makeDbCall(() =>
      db
        .update(chapters)
        .set(updates)
        .where(eq(chapters.id, clipSectionId))
        .returning()
    );

    if (!clipSection) {
      return yield* new NotFoundError({
        type: "updateClipSection",
        params: { clipSectionId },
      });
    }

    return clipSection;
  });

  const archiveClipSection = Effect.fn("archiveClipSection")(function* (
    clipSectionId: string
  ) {
    const clipSectionExists = yield* makeDbCall(() =>
      db.query.chapters.findFirst({
        where: eq(chapters.id, clipSectionId),
      })
    );

    if (!clipSectionExists) {
      return yield* new NotFoundError({
        type: "archiveClipSection",
        params: { clipSectionId },
      });
    }

    yield* makeDbCall(() =>
      db
        .update(chapters)
        .set({ archived: true })
        .where(eq(chapters.id, clipSectionId))
    );

    return { success: true };
  });

  const reorderClipSection = Effect.fn("reorderClipSection")(function* (
    clipSectionId: string,
    direction: "up" | "down"
  ) {
    // Get the clip section to know what video we're working with
    const clipSection = yield* makeDbCall(() =>
      db.query.chapters.findFirst({
        where: eq(chapters.id, clipSectionId),
      })
    );

    if (!clipSection) {
      return yield* new NotFoundError({
        type: "reorderClipSection",
        params: { clipSectionId },
      });
    }

    // Get all non-archived clips and clip sections for this video, ordered
    const allClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: and(
          eq(clips.videoId, clipSection.videoId),
          eq(clips.archived, false)
        ),
        orderBy: asc(clips.order),
      })
    );

    const allClipSections = yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: and(
          eq(chapters.videoId, clipSection.videoId),
          eq(chapters.archived, false)
        ),
        orderBy: asc(chapters.order),
      })
    );

    // Combine and sort by order
    const allItems = [
      ...allClips.map((c) => ({ type: "clip" as const, ...c })),
      ...allClipSections.map((cs) => ({
        type: "clip-section" as const,
        ...cs,
      })),
    ].sort((a, b) => compareOrderStrings(a.order, b.order));

    const itemIndex = allItems.findIndex(
      (item) => item.type === "clip-section" && item.id === clipSectionId
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
        .where(eq(chapters.id, clipSectionId))
    );

    return { success: true };
  });

  const appendClips = Effect.fn("addClips")(function* (opts: {
    videoId: string;
    insertionPoint:
      | { type: "start" }
      | { type: "after-clip"; databaseClipId: string }
      | { type: "after-clip-section"; clipSectionId: string };
    clips: readonly {
      inputVideo: string;
      startTime: number;
      endTime: number;
    }[];
  }) {
    const { videoId, insertionPoint, clips: inputClips } = opts;
    let prevOrder: string | null | undefined = null;
    let nextOrder: string | null | undefined = null;

    // Get all non-archived clips and clip sections for this video
    const allClips = yield* makeDbCall(() =>
      db.query.clips.findMany({
        where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
        orderBy: asc(clips.order),
      })
    );

    const allClipSections = yield* makeDbCall(() =>
      db.query.chapters.findMany({
        where: and(eq(chapters.videoId, videoId), eq(chapters.archived, false)),
        orderBy: asc(chapters.order),
      })
    );

    // Combine and sort by order to get correct insertion position
    const allItems = [
      ...allClips.map((c) => ({ type: "clip" as const, ...c })),
      ...allClipSections.map((cs) => ({
        type: "clip-section" as const,
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
    } else if (insertionPoint.type === "after-clip-section") {
      // Insert after specific clip section
      const insertAfterSectionIndex = allItems.findIndex(
        (item) =>
          item.type === "clip-section" &&
          item.id === insertionPoint.clipSectionId
      );

      if (insertAfterSectionIndex === -1) {
        return yield* new NotFoundError({
          type: "appendClips",
          params: { videoId, insertionPoint },
          message: `Could not find a clip section to insert after`,
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
    createClipSection,
    createClipSectionAtInsertionPoint,
    createClipSectionAtPosition,
    getClipSectionById,
    updateClipSection,
    archiveClipSection,
    reorderClipSection,
    appendClips,
  };
};
