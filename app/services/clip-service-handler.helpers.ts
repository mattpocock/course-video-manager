/**
 * Helper functions and types for ClipService handler.
 */

import { clips, chapters, videos } from "@/db/schema";
import { compareOrderStrings } from "@/lib/sort-by-order";
import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { generateNKeysBetween } from "fractional-indexing";
import type {
  ClipServiceEvent,
  CreateVideoFromSelectionInput,
} from "./clip-service";
import type { DrizzleService } from "./drizzle-service.server";
import type { LogEvent } from "./video-editor-logger-service";
import type { PauseLength } from "@/silence-detection-constants";

// ============================================================================
// Types
// ============================================================================

/**
 * Adapter for VideoProcessingService functionality.
 * In production, this wraps the Effect-based service.
 * In tests, this is mocked.
 */
export interface VideoProcessingAdapter {
  getLatestOBSVideoClips: (opts: {
    filePath: string | undefined;
    startTime: number | undefined;
    pauseLength?: PauseLength;
  }) => Promise<{
    readonly clips: ReadonlyArray<{
      readonly inputVideo: string;
      readonly startTime: number;
      readonly endTime: number;
    }>;
  }>;
}

/**
 * Adapter for VideoEditorLoggerService.
 * In production, wraps the Effect-based logger service.
 * In tests, can be a no-op.
 */
export interface LoggerAdapter {
  log: (videoId: string, event: LogEvent) => void;
}

export const noopLogger: LoggerAdapter = { log: () => {} };

// ============================================================================
// Helper: Windows to WSL path conversion
// ============================================================================

export function windowsToWSL(windowsPath: string): string {
  // Convert C:\Users\... to /mnt/c/Users/...
  const drive = windowsPath.charAt(0).toLowerCase();
  const pathWithoutDrive = windowsPath.slice(3); // Remove "C:\"

  // Convert backslashes to forward slashes
  const unixPath = pathWithoutDrive.replace(/\\/g, "/");

  return `/mnt/${drive}/${unixPath}`;
}

// ============================================================================
// Helper: Get all items for a video sorted by order
// ============================================================================

export const getOrderedItems = Effect.fn("getOrderedItems")(function* (
  db: DrizzleService,
  videoId: string
) {
  const allClips = yield* Effect.promise(() =>
    db.query.clips.findMany({
      where: and(eq(clips.videoId, videoId), eq(clips.archived, false)),
      orderBy: asc(clips.order),
    })
  );

  const allChapters = yield* Effect.promise(() =>
    db.query.chapters.findMany({
      where: and(eq(chapters.videoId, videoId), eq(chapters.archived, false)),
      orderBy: asc(chapters.order),
    })
  );

  const allItems = [
    ...allClips.map((c) => ({ type: "clip" as const, ...c })),
    ...allChapters.map((cs) => ({
      type: "chapter" as const,
      ...cs,
    })),
  ].sort((a, b) => compareOrderStrings(a.order, b.order));

  return allItems;
});

// ============================================================================
// Helper: Touch video updatedAt timestamp
// ============================================================================

export const touchVideoUpdatedAt = (db: DrizzleService, videoId: string) =>
  Effect.promise(() =>
    db
      .update(videos)
      .set({ updatedAt: new Date() })
      .where(eq(videos.id, videoId))
  );

// ============================================================================
// Helper: Append clips at an insertion point
// ============================================================================

export const appendClipsAtInsertionPoint = Effect.fn(
  "appendClipsAtInsertionPoint"
)(function* (
  db: DrizzleService,
  input: Extract<ClipServiceEvent, { type: "append-clips" }>["input"]
) {
  const { videoId, insertionPoint, clips: inputClips } = input;
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
      (item) => item.type === "chapter" && item.id === insertionPoint.chapterId
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

  const orders = generateNKeysBetween(prevOrder, nextOrder, inputClips.length);

  const insertValues = inputClips.map((clip, index) => ({
    videoId,
    videoFilename: clip.inputVideo,
    sourceStartTime: clip.startTime,
    sourceEndTime: clip.endTime,
    order: orders[index]!,
    archived: false,
    text: "",
  }));

  const clipsResult = yield* Effect.promise(() =>
    db.insert(clips).values(insertValues).returning()
  );

  return clipsResult;
});

// ============================================================================
// Mutex: Serialize append-from-obs calls per videoId
// ============================================================================

const videoMutexes = new Map<string, Promise<void>>();

export async function withVideoMutex<T>(
  videoId: string,
  fn: () => Promise<T>
): Promise<T> {
  const prior = videoMutexes.get(videoId) ?? Promise.resolve();

  let releaseMutex: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseMutex = resolve;
  });
  videoMutexes.set(videoId, gate);

  try {
    await prior;
    return await fn();
  } finally {
    releaseMutex!();
    if (videoMutexes.get(videoId) === gate) {
      videoMutexes.delete(videoId);
    }
  }
}

// ============================================================================
// Helper: append-from-obs implementation (runs inside mutex)
// ============================================================================

export const appendFromObsImpl = (
  db: DrizzleService,
  event: Extract<ClipServiceEvent, { type: "append-from-obs" }>,
  videoProcessing: VideoProcessingAdapter,
  logger: LoggerAdapter
) =>
  Effect.gen(function* () {
    const { videoId, filePath, insertionPoint } = event.input;

    // Convert Windows path to WSL path if provided
    const resolvedFilePath = filePath ? windowsToWSL(filePath) : undefined;

    // Get all clips (including archived) to find the last clip with this input video
    const allClipsIncludingArchived = yield* Effect.promise(() =>
      db.query.clips.findMany({
        where: eq(clips.videoId, videoId),
      })
    );

    // Find clips with this input video and get the one with the latest end time
    const clipsWithThisInputVideo = allClipsIncludingArchived
      .filter((clip) => clip.videoFilename === resolvedFilePath)
      .sort((a, b) => b.sourceStartTime - a.sourceStartTime);

    const lastClipWithThisInputVideo = clipsWithThisInputVideo[0];

    // Calculate start time: end time of last clip - 1 second for silence gap
    const resolvedStartTime =
      typeof lastClipWithThisInputVideo?.sourceEndTime === "number"
        ? Math.max(lastClipWithThisInputVideo.sourceEndTime - 1, 0)
        : undefined;

    // Call CLI to detect clips
    const latestOBSVideoClips = yield* Effect.promise(() =>
      videoProcessing.getLatestOBSVideoClips({
        filePath: resolvedFilePath,
        startTime: resolvedStartTime,
        pauseLength: event.input.pauseLength,
      })
    );

    if (latestOBSVideoClips.clips.length === 0) {
      logger.log(videoId, {
        type: "clips-appended-from-obs",
        videoId,
        detected: 0,
        duplicatesSkipped: 0,
        inserted: 0,
        clips: [],
      });
      return [];
    }

    // Re-fetch clips for deduplication (in case they changed during CLI detection)
    const allClipsForDedup = yield* Effect.promise(() =>
      db.query.clips.findMany({
        where: eq(clips.videoId, videoId),
      })
    );

    // Filter out clips that already exist (deduplicate by videoFilename + startTime + endTime)
    // Uses a tolerance of 0.6s to account for ffmpeg silence detection variance across runs.
    // Silence detection start times can drift by 0.24-0.57s depending on keyframe alignment.
    // 0.6s is safe because minimum clip length is 1s, so distinct clips can't match.
    const DEDUP_TOLERANCE_SECONDS = 0.6;
    const clipsToAdd = latestOBSVideoClips.clips.filter(
      (clip) =>
        !allClipsForDedup.some(
          (existingClip) =>
            existingClip.videoFilename === clip.inputVideo &&
            Math.abs(existingClip.sourceStartTime - clip.startTime) <
              DEDUP_TOLERANCE_SECONDS &&
            Math.abs(existingClip.sourceEndTime - clip.endTime) <
              DEDUP_TOLERANCE_SECONDS
        )
    );

    if (clipsToAdd.length === 0) {
      logger.log(videoId, {
        type: "clips-appended-from-obs",
        videoId,
        detected: latestOBSVideoClips.clips.length,
        duplicatesSkipped: latestOBSVideoClips.clips.length,
        inserted: 0,
        clips: [],
      });
      return [];
    }

    const result = yield* appendClipsAtInsertionPoint(db, {
      videoId,
      insertionPoint,
      clips: clipsToAdd,
    });

    yield* touchVideoUpdatedAt(db, videoId);

    const totalDuplicatesSkipped =
      latestOBSVideoClips.clips.length - result.length;

    logger.log(videoId, {
      type: "clips-appended-from-obs",
      videoId,
      detected: latestOBSVideoClips.clips.length,
      duplicatesSkipped: totalDuplicatesSkipped,
      inserted: result.length,
      clips: result.map((c) => ({
        inputVideo: c.videoFilename,
        startTime: c.sourceStartTime,
        endTime: c.sourceEndTime,
      })),
    });

    return result;
  });

// ============================================================================
// Handler: create-video-from-selection
// ============================================================================

export const handleCreateVideoFromSelection = Effect.fn(
  "handleCreateVideoFromSelection"
)(function* (
  db: DrizzleService,
  input: CreateVideoFromSelectionInput,
  logger: LoggerAdapter
) {
  const { sourceVideoId, clipIds, chapterIds, title, mode } = input;

  // Get the source video to inherit lessonId
  const sourceVideo = yield* Effect.promise(() =>
    db.query.videos.findFirst({
      where: eq(videos.id, sourceVideoId),
    })
  );

  if (!sourceVideo) {
    throw new Error(`Source video not found: ${sourceVideoId}`);
  }

  // Create the new video
  const [newVideo] = yield* Effect.promise(() =>
    db
      .insert(videos)
      .values({
        path: title,
        originalFootagePath: title,
        lessonId: sourceVideo.lessonId,
      })
      .returning()
  );

  if (!newVideo) {
    throw new Error("Failed to create new video");
  }

  // Get all items from source video to determine their relative order
  const allItems = yield* getOrderedItems(db, sourceVideoId);

  // Build sets for quick lookup
  const selectedClipIds = new Set(clipIds);
  const selectedSectionIds = new Set(chapterIds);

  // Filter to only selected items, preserving original timeline order
  const selectedItems = allItems.filter((item) => {
    if (item.type === "clip") {
      return selectedClipIds.has(item.id);
    } else {
      return selectedSectionIds.has(item.id);
    }
  });

  // Generate fresh order keys for the new video
  const orders = generateNKeysBetween(null, null, selectedItems.length);

  // Copy each selected item to the new video
  for (let i = 0; i < selectedItems.length; i++) {
    const item = selectedItems[i]!;
    const order = orders[i]!;

    if (item.type === "clip") {
      yield* Effect.promise(() =>
        db.insert(clips).values({
          videoId: newVideo.id,
          videoFilename: item.videoFilename,
          sourceStartTime: item.sourceStartTime,
          sourceEndTime: item.sourceEndTime,
          order,
          archived: false,
          text: item.text,
          transcribedAt: item.transcribedAt,
          scene: item.scene,
          profile: item.profile,
          beatType: item.beatType,
        })
      );
    } else {
      yield* Effect.promise(() =>
        db.insert(chapters).values({
          videoId: newVideo.id,
          name: item.name,
          order,
          archived: false,
        })
      );
    }
  }

  // In move mode, archive the originals from the source video
  if (mode === "move") {
    for (const clipId of clipIds) {
      yield* Effect.promise(() =>
        db.update(clips).set({ archived: true }).where(eq(clips.id, clipId))
      );
    }

    for (const chapterId of chapterIds) {
      yield* Effect.promise(() =>
        db
          .update(chapters)
          .set({ archived: true })
          .where(eq(chapters.id, chapterId))
      );
    }

    yield* touchVideoUpdatedAt(db, sourceVideoId);
  }

  logger.log(sourceVideoId, {
    type: "video-created-from-selection",
    sourceVideoId,
    clipIds: [...clipIds],
    newVideoId: newVideo.id,
  });

  return newVideo;
});
