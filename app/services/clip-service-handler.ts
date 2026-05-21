/**
 * ClipService Handler
 *
 * This file contains the handler function that processes ClipServiceEvents
 * and the direct transport factory for testing.
 *
 * The handler pattern-matches on the event type and dispatches to the
 * appropriate database operations.
 */

import { clips, chapters, videos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import {
  createClipService,
  type ClipService,
  type ClipServiceEvent,
  type TimelineItem,
} from "./clip-service";
import {
  type VideoProcessingAdapter,
  type LoggerAdapter,
  noopLogger,
  getOrderedItems,
  touchVideoUpdatedAt,
  appendClipsAtInsertionPoint,
  withVideoMutex,
  appendFromObsImpl,
  handleCreateVideoFromSelection,
} from "./clip-service-handler.helpers";
import type { DrizzleService } from "./drizzle-service.server";

export type { VideoProcessingAdapter, LoggerAdapter };

// ============================================================================
// Handler
// ============================================================================

/**
 * Handles a ClipServiceEvent by dispatching to the appropriate database operation.
 * This is the core business logic that both HTTP and direct transports use.
 *
 * @param db - Drizzle database instance
 * @param event - The event to handle
 * @param videoProcessing - VideoProcessingService adapter (required for append-from-obs)
 */
export const handleClipServiceEvent = Effect.fn("handleClipServiceEvent")(
  function* (
    db: DrizzleService,
    event: ClipServiceEvent,
    videoProcessing: VideoProcessingAdapter,
    logger: LoggerAdapter = noopLogger
  ) {
    switch (event.type) {
      case "create-video": {
        const [video] = yield* Effect.promise(() =>
          db
            .insert(videos)
            .values({
              path: event.path,
              originalFootagePath: "",
              lessonId: null,
            })
            .returning()
        );

        if (!video) {
          throw new Error("Failed to create video");
        }

        return video;
      }

      case "get-timeline": {
        const allItems = yield* getOrderedItems(db, event.videoId);

        const timeline: TimelineItem[] = allItems.map((item) => {
          if (item.type === "clip") {
            const { type, ...clipData } = item;
            return { type: "clip", data: clipData };
          } else {
            const { type, ...sectionData } = item;
            return { type: "chapter", data: sectionData };
          }
        });

        return timeline;
      }

      case "append-clips": {
        const result = yield* appendClipsAtInsertionPoint(db, event.input);

        yield* touchVideoUpdatedAt(db, event.input.videoId);

        logger.log(event.input.videoId, {
          type: "clips-appended",
          videoId: event.input.videoId,
          insertionPoint: event.input.insertionPoint,
          clips: event.input.clips.map((c) => ({
            inputVideo: c.inputVideo,
            startTime: c.startTime,
            endTime: c.endTime,
          })),
          generatedOrders: result.map((c) => c.order),
        });

        return result;
      }

      case "append-from-obs": {
        if (!videoProcessing) {
          throw new Error(
            "VideoProcessingAdapter is required for append-from-obs"
          );
        }

        // Serialize concurrent append-from-obs calls for the same video
        // via an in-memory mutex to prevent duplicate clip inserts
        return yield* Effect.promise(() =>
          withVideoMutex(event.input.videoId, () =>
            Effect.runPromise(
              appendFromObsImpl(db, event, videoProcessing, logger)
            )
          )
        );
      }

      case "archive-clips": {
        for (const clipId of event.clipIds) {
          yield* Effect.promise(() =>
            db.update(clips).set({ archived: true }).where(eq(clips.id, clipId))
          );
        }

        // We need the videoId for logging — look up from first clip
        if (event.clipIds.length > 0) {
          const firstClip = yield* Effect.promise(() =>
            db.query.clips.findFirst({
              where: eq(clips.id, event.clipIds[0]!),
            })
          );
          if (firstClip) {
            yield* touchVideoUpdatedAt(db, firstClip.videoId);
            logger.log(firstClip.videoId, {
              type: "clips-archived",
              clipIds: [...event.clipIds],
            });
          }
        }
        return;
      }

      case "unarchive-clips": {
        for (const clipId of event.clipIds) {
          yield* Effect.promise(() =>
            db
              .update(clips)
              .set({ archived: false })
              .where(eq(clips.id, clipId))
          );
        }

        if (event.clipIds.length > 0) {
          const firstClip = yield* Effect.promise(() =>
            db.query.clips.findFirst({
              where: eq(clips.id, event.clipIds[0]!),
            })
          );
          if (firstClip) {
            yield* touchVideoUpdatedAt(db, firstClip.videoId);
            logger.log(firstClip.videoId, {
              type: "clips-unarchived",
              clipIds: [...event.clipIds],
            });
          }
        }
        return;
      }

      case "update-clips": {
        for (const clip of event.clips) {
          yield* Effect.promise(() =>
            db
              .update(clips)
              .set({
                scene: clip.scene,
                profile: clip.profile,
                beatType: clip.beatType,
              })
              .where(eq(clips.id, clip.id))
          );
        }

        if (event.clips.length > 0) {
          const firstClip = yield* Effect.promise(() =>
            db.query.clips.findFirst({
              where: eq(clips.id, event.clips[0]!.id),
            })
          );
          if (firstClip) {
            yield* touchVideoUpdatedAt(db, firstClip.videoId);
            logger.log(firstClip.videoId, {
              type: "clips-updated",
              clips: event.clips.map((c) => ({
                id: c.id,
                scene: c.scene,
                profile: c.profile,
                beatType: c.beatType,
              })),
            });
          }
        }
        return;
      }

      case "update-beat": {
        yield* Effect.promise(() =>
          db
            .update(clips)
            .set({ beatType: event.beatType })
            .where(eq(clips.id, event.clipId))
        );

        const clip = yield* Effect.promise(() =>
          db.query.clips.findFirst({
            where: eq(clips.id, event.clipId),
          })
        );
        if (clip) {
          yield* touchVideoUpdatedAt(db, clip.videoId);
          logger.log(clip.videoId, {
            type: "beat-updated",
            clipId: event.clipId,
            beatType: event.beatType,
          });
        }
        return;
      }

      case "reorder-clip": {
        const clip = yield* Effect.promise(() =>
          db.query.clips.findFirst({
            where: eq(clips.id, event.clipId),
          })
        );

        if (!clip) {
          throw new Error(`Clip not found: ${event.clipId}`);
        }

        const allItems = yield* getOrderedItems(db, clip.videoId);

        const itemIndex = allItems.findIndex(
          (item) => item.type === "clip" && item.id === event.clipId
        );
        const targetIndex =
          event.direction === "up" ? itemIndex - 1 : itemIndex + 1;

        if (targetIndex < 0 || targetIndex >= allItems.length) {
          return;
        }

        let newOrder: string;
        if (event.direction === "up") {
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

        yield* Effect.promise(() =>
          db
            .update(clips)
            .set({ order: newOrder })
            .where(eq(clips.id, event.clipId))
        );

        yield* touchVideoUpdatedAt(db, clip.videoId);

        logger.log(clip.videoId, {
          type: "clip-reordered",
          clipId: event.clipId,
          direction: event.direction,
        });
        return;
      }

      case "create-chapter-at-insertion-point": {
        const { videoId, name, insertionPoint } = event.input;
        const allItems = yield* getOrderedItems(db, videoId);

        let prevOrder: string | null = null;
        let nextOrder: string | null = null;

        if (insertionPoint.type === "start") {
          const firstItem = allItems[0];
          nextOrder = firstItem?.order ?? null;
        } else if (insertionPoint.type === "after-clip") {
          const insertAfterClipIndex = allItems.findIndex(
            (item) =>
              item.type === "clip" && item.id === insertionPoint.databaseClipId
          );

          if (insertAfterClipIndex === -1) {
            throw new Error(
              `Could not find a clip to insert after: ${insertionPoint.databaseClipId}`
            );
          }

          const insertAfterItem = allItems[insertAfterClipIndex];
          prevOrder = insertAfterItem?.order ?? null;

          const nextItem = allItems[insertAfterClipIndex + 1];
          nextOrder = nextItem?.order ?? null;
        } else if (insertionPoint.type === "after-chapter") {
          const insertAfterSectionIndex = allItems.findIndex(
            (item) =>
              item.type === "chapter" && item.id === insertionPoint.chapterId
          );

          if (insertAfterSectionIndex === -1) {
            throw new Error(
              `Could not find a chapter to insert after: ${insertionPoint.chapterId}`
            );
          }

          const insertAfterItem = allItems[insertAfterSectionIndex];
          prevOrder = insertAfterItem?.order ?? null;

          const nextItem = allItems[insertAfterSectionIndex + 1];
          nextOrder = nextItem?.order ?? null;
        }

        const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

        const [chapter] = yield* Effect.promise(() =>
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
          throw new Error("Failed to create chapter");
        }

        yield* touchVideoUpdatedAt(db, videoId);

        logger.log(videoId, {
          type: "chapter-created",
          sectionId: chapter.id,
          name,
          order: order!,
        });

        return chapter;
      }

      case "create-chapter-at-position": {
        const { videoId, name, position, targetItemId, targetItemType } =
          event.input;
        const allItems = yield* getOrderedItems(db, videoId);

        const targetIndex = allItems.findIndex(
          (item) => item.type === targetItemType && item.id === targetItemId
        );

        if (targetIndex === -1) {
          throw new Error(
            `Could not find target ${targetItemType}: ${targetItemId}`
          );
        }

        let prevOrder: string | null = null;
        let nextOrder: string | null = null;

        if (position === "before") {
          nextOrder = allItems[targetIndex]?.order ?? null;
          const prevItem = allItems[targetIndex - 1];
          prevOrder = prevItem?.order ?? null;
        } else {
          prevOrder = allItems[targetIndex]?.order ?? null;
          const nextItem = allItems[targetIndex + 1];
          nextOrder = nextItem?.order ?? null;
        }

        const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

        const [chapter] = yield* Effect.promise(() =>
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
          throw new Error("Failed to create chapter");
        }

        yield* touchVideoUpdatedAt(db, videoId);

        logger.log(videoId, {
          type: "chapter-created",
          sectionId: chapter.id,
          name,
          order: order!,
        });

        return chapter;
      }

      case "update-chapter": {
        yield* Effect.promise(() =>
          db
            .update(chapters)
            .set({ name: event.name })
            .where(eq(chapters.id, event.chapterId))
        );

        const section = yield* Effect.promise(() =>
          db.query.chapters.findFirst({
            where: eq(chapters.id, event.chapterId),
          })
        );
        if (section) {
          yield* touchVideoUpdatedAt(db, section.videoId);
          logger.log(section.videoId, {
            type: "chapter-updated",
            chapterId: event.chapterId,
            name: event.name,
          });
        }
        return;
      }

      case "archive-chapters": {
        for (const chapterId of event.chapterIds) {
          yield* Effect.promise(() =>
            db
              .update(chapters)
              .set({ archived: true })
              .where(eq(chapters.id, chapterId))
          );
        }

        if (event.chapterIds.length > 0) {
          const firstSection = yield* Effect.promise(() =>
            db.query.chapters.findFirst({
              where: eq(chapters.id, event.chapterIds[0]!),
            })
          );
          if (firstSection) {
            yield* touchVideoUpdatedAt(db, firstSection.videoId);
            logger.log(firstSection.videoId, {
              type: "chapters-archived",
              chapterIds: [...event.chapterIds],
            });
          }
        }
        return;
      }

      case "reorder-chapter": {
        const chapter = yield* Effect.promise(() =>
          db.query.chapters.findFirst({
            where: eq(chapters.id, event.chapterId),
          })
        );

        if (!chapter) {
          throw new Error(`Chapter not found: ${event.chapterId}`);
        }

        const allItems = yield* getOrderedItems(db, chapter.videoId);

        const itemIndex = allItems.findIndex(
          (item) => item.type === "chapter" && item.id === event.chapterId
        );
        const targetIndex =
          event.direction === "up" ? itemIndex - 1 : itemIndex + 1;

        if (targetIndex < 0 || targetIndex >= allItems.length) {
          return;
        }

        let newOrder: string;
        if (event.direction === "up") {
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

        yield* Effect.promise(() =>
          db
            .update(chapters)
            .set({ order: newOrder })
            .where(eq(chapters.id, event.chapterId))
        );

        yield* touchVideoUpdatedAt(db, chapter.videoId);

        logger.log(chapter.videoId, {
          type: "chapter-reordered",
          chapterId: event.chapterId,
          direction: event.direction,
        });
        return;
      }

      case "create-effect-clip-at-position": {
        const {
          videoId,
          position,
          targetItemId,
          targetItemType,
          videoFilename,
          sourceStartTime,
          sourceEndTime,
          text,
          scene,
          profile,
          beatType,
        } = event.input;
        const allItems = yield* getOrderedItems(db, videoId);

        const targetIndex = allItems.findIndex(
          (item) => item.type === targetItemType && item.id === targetItemId
        );

        if (targetIndex === -1) {
          throw new Error(
            `Could not find target ${targetItemType}: ${targetItemId}`
          );
        }

        let prevOrder: string | null = null;
        let nextOrder: string | null = null;

        if (position === "before") {
          nextOrder = allItems[targetIndex]?.order ?? null;
          const prevItem = allItems[targetIndex - 1];
          prevOrder = prevItem?.order ?? null;
        } else {
          prevOrder = allItems[targetIndex]?.order ?? null;
          const nextItem = allItems[targetIndex + 1];
          nextOrder = nextItem?.order ?? null;
        }

        const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

        const [clip] = yield* Effect.promise(() =>
          db
            .insert(clips)
            .values({
              videoId,
              videoFilename,
              sourceStartTime,
              sourceEndTime,
              text,
              scene,
              profile,
              beatType,
              order: order!,
              archived: false,
              transcribedAt: new Date(),
            })
            .returning()
        );

        if (!clip) {
          throw new Error("Failed to create effect clip");
        }

        yield* touchVideoUpdatedAt(db, videoId);

        logger.log(videoId, {
          type: "effect-clip-created",
          clipId: clip.id,
          text,
          scene,
          order: order!,
        });

        return clip;
      }

      case "create-video-from-selection": {
        return yield* handleCreateVideoFromSelection(db, event.input, logger);
      }

      case "regenerate-chapters": {
        const { videoId, sections: proposed } = event.input;

        const orderedClips = yield* Effect.promise(() =>
          db.query.clips.findMany({
            where: eq(clips.videoId, videoId),
            orderBy: (table, { asc }) => asc(table.order),
          })
        );

        const activeClips = orderedClips.filter((c) => !c.archived);
        const clipIndexById = new Map(activeClips.map((c, i) => [c.id, i]));

        const seen = new Set<string>();
        const validatedProposed = proposed
          .filter((s) => {
            if (seen.has(s.beforeClipId)) return false;
            if (!clipIndexById.has(s.beforeClipId)) return false;
            seen.add(s.beforeClipId);
            return true;
          })
          .map((s) => ({
            ...s,
            clipIndex: clipIndexById.get(s.beforeClipId)!,
          }))
          .sort((a, b) => a.clipIndex - b.clipIndex);

        yield* Effect.promise(() =>
          db
            .update(chapters)
            .set({ archived: true })
            .where(eq(chapters.videoId, videoId))
        );

        const inserted: Array<
          typeof chapters.$inferSelect & { beforeClipId: string }
        > = [];
        for (const p of validatedProposed) {
          const targetClip = activeClips[p.clipIndex]!;
          const prevClip = activeClips[p.clipIndex - 1];
          const prevOrder = prevClip?.order ?? null;
          const nextOrder = targetClip.order;

          const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);

          const [row] = yield* Effect.promise(() =>
            db
              .insert(chapters)
              .values({
                videoId,
                name: p.title,
                order: order!,
                archived: false,
              })
              .returning()
          );

          if (!row) throw new Error("Failed to insert Chapter");
          inserted.push({ ...row, beforeClipId: p.beforeClipId });
        }

        yield* touchVideoUpdatedAt(db, videoId);

        logger.log(videoId, {
          type: "chapters-regenerated",
          count: inserted.length,
          titles: inserted.map((s) => s.name),
        });

        return inserted;
      }

      default: {
        const _exhaustive: never = event;
        throw new Error(`Unknown event type: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
);

// ============================================================================
// Direct Transport Factory (for tests)
// ============================================================================

/**
 * Creates a ClipService that calls the handler directly with the provided
 * database instance. Used for testing with PGlite.
 *
 * @param db - Drizzle database instance
 * @param videoProcessing - VideoProcessingService adapter for OBS functionality
 */
export function createDirectClipService(
  db: DrizzleService,
  videoProcessing: VideoProcessingAdapter,
  logger?: LoggerAdapter
): ClipService {
  const send = (event: ClipServiceEvent): Promise<unknown> => {
    return Effect.runPromise(
      handleClipServiceEvent(db, event, videoProcessing, logger ?? noopLogger)
    );
  };

  return createClipService(send);
}
