/**
 * ClipService - Deep module with RPC transport for clip operations
 *
 * This service provides a simple, typed, Promise-based interface for all clip
 * and chapter operations. The frontend calls typed methods, and internally
 * these are dispatched through an RPC-style transport.
 *
 * Two transports are available:
 * - HTTP transport (production): Single fetch to /clip-service route
 * - Direct transport (tests): Calls handler directly with PGlite
 */

import type { InferSelectModel } from "drizzle-orm";
import type { clips, chapters, videos } from "@/db/schema";
import type { PauseLength } from "@/silence-detection-constants";
// ============================================================================
// Database Types
// ============================================================================

export type Clip = InferSelectModel<typeof clips>;
export type Chapter = InferSelectModel<typeof chapters>;
export type RegeneratedChapter = Chapter & { beforeClipId: string };
export type Video = InferSelectModel<typeof videos>;

// ============================================================================
// Insertion Point Types
// ============================================================================

/**
 * Internal insertion point type for database operations.
 * Not exported - consumers use FrontendInsertionPoint instead.
 */
type InsertionPoint =
  | { type: "start" }
  | { type: "after-clip"; databaseClipId: string }
  | { type: "after-chapter"; chapterId: string };

/**
 * Position for creating chapters relative to a target item.
 * Used by createChapterAtPosition.
 */
export type Position = "before" | "after";
export type TargetItemType = "clip" | "chapter";

// ============================================================================
// Timeline Types
// ============================================================================

/**
 * Unified timeline item - either a clip or a chapter.
 * Returned by getTimeline, sorted by order.
 */
export type TimelineItem =
  | { type: "clip"; data: Clip }
  | { type: "chapter"; data: Chapter };

// ============================================================================
// Direction Types
// ============================================================================

export type ReorderDirection = "up" | "down";

// ============================================================================
// Frontend Insertion Point Types
// ============================================================================

/**
 * Branded string types for frontend vs database IDs.
 * Frontend IDs are temporary (UUID generated on the client).
 * Database IDs come from the database after persistence.
 */
export type FrontendId = string & { readonly __brand: "FrontendId" };
export type DatabaseId = string & { readonly __brand: "DatabaseId" };

/**
 * Frontend insertion point - uses frontend IDs.
 * Used by the video editor reducer to track where new clips should go.
 */
export type FrontendInsertionPoint =
  | { type: "start" }
  | { type: "after-clip"; frontendClipId: FrontendId }
  | { type: "after-chapter"; frontendChapterId: FrontendId }
  | { type: "end" };

/**
 * Frontend timeline item types - items can be optimistic (not yet persisted)
 * or on-database (already saved).
 */
export type FrontendTimelineItem =
  | {
      type: "on-database";
      frontendId: FrontendId;
      databaseId: DatabaseId;
      shouldArchive?: boolean;
    }
  | { type: "optimistically-added"; frontendId: FrontendId }
  | {
      type: "chapter-on-database";
      frontendId: FrontendId;
      databaseId: DatabaseId;
    }
  | { type: "chapter-optimistically-added"; frontendId: FrontendId }
  | { type: "effect-clip-optimistically-added"; frontendId: FrontendId };

/**
 * Converts a frontend insertion point to a database insertion point.
 * This resolves optimistic items to their nearest persisted ancestor.
 *
 * Internal to ClipService - consumers pass FrontendInsertionPoint and items
 * to ClipService methods, and the conversion happens automatically.
 */
/** Check if an item is persisted and not pending archival */
const isPersistedAndActive = (
  c: FrontendTimelineItem
): c is
  | Extract<FrontendTimelineItem, { type: "on-database" }>
  | Extract<FrontendTimelineItem, { type: "chapter-on-database" }> =>
  (c.type === "on-database" && !c.shouldArchive) ||
  c.type === "chapter-on-database";

const resolveInsertionPoint = (
  insertionPoint: FrontendInsertionPoint,
  items: FrontendTimelineItem[]
): InsertionPoint => {
  if (insertionPoint.type === "start") {
    return { type: "start" };
  }

  if (insertionPoint.type === "after-clip") {
    const frontendClipIndex = items.findIndex(
      (c) => c.frontendId === insertionPoint.frontendClipId
    );
    if (frontendClipIndex === -1) {
      throw new Error("Clip not found");
    }

    const previousPersistedItem = items
      .slice(0, frontendClipIndex + 1)
      .findLast(isPersistedAndActive);

    if (!previousPersistedItem) {
      return { type: "start" };
    }

    if (previousPersistedItem.type === "chapter-on-database") {
      return {
        type: "after-chapter",
        chapterId: previousPersistedItem.databaseId,
      };
    }

    return {
      type: "after-clip",
      databaseClipId: previousPersistedItem.databaseId,
    };
  }

  if (insertionPoint.type === "after-chapter") {
    const frontendChapterIndex = items.findIndex(
      (c) => c.frontendId === insertionPoint.frontendChapterId
    );
    if (frontendChapterIndex === -1) {
      throw new Error("Chapter not found");
    }

    const section = items[frontendChapterIndex]!;

    // If the section is persisted, use the new after-chapter API type
    if (section.type === "chapter-on-database") {
      return {
        type: "after-chapter",
        chapterId: section.databaseId,
      };
    }

    // Optimistic section (no DB ID yet) — fall back to last persisted item before it
    const previousPersistedItem = items
      .slice(0, frontendChapterIndex + 1)
      .findLast(isPersistedAndActive);

    if (!previousPersistedItem) {
      return { type: "start" };
    }

    if (previousPersistedItem.type === "chapter-on-database") {
      return {
        type: "after-chapter",
        chapterId: previousPersistedItem.databaseId,
      };
    }

    return {
      type: "after-clip",
      databaseClipId: previousPersistedItem.databaseId,
    };
  }

  if (insertionPoint.type === "end") {
    // Find the last persisted item (clip or section)
    const lastPersistedItem = items.findLast(isPersistedAndActive);

    if (!lastPersistedItem) {
      return { type: "start" };
    }

    if (lastPersistedItem.type === "chapter-on-database") {
      return {
        type: "after-chapter",
        chapterId: lastPersistedItem.databaseId,
      };
    }

    return {
      type: "after-clip",
      databaseClipId: lastPersistedItem.databaseId,
    };
  }

  throw new Error("Invalid insertion point");
};

// ============================================================================
// Input Types for Methods (Public - accept FrontendInsertionPoint)
// ============================================================================

export interface AppendClipsInput {
  videoId: string;
  insertionPoint: FrontendInsertionPoint;
  items: FrontendTimelineItem[];
  clips: readonly {
    inputVideo: string;
    startTime: number;
    endTime: number;
  }[];
}

export interface AppendFromObsInput {
  videoId: string;
  filePath?: string;
  insertionPoint: FrontendInsertionPoint;
  items: FrontendTimelineItem[];
  pauseLength?: PauseLength;
}

export interface UpdateClipInput {
  id: string;
  scene: string;
  profile: string;
  beatType: string;
}

export interface CreateChapterAtInsertionPointInput {
  videoId: string;
  name: string;
  insertionPoint: FrontendInsertionPoint;
  items: FrontendTimelineItem[];
}

export interface CreateChapterAtPositionInput {
  videoId: string;
  name: string;
  position: Position;
  targetItemId: string;
  targetItemType: TargetItemType;
}

export interface CreateEffectClipAtPositionInput {
  videoId: string;
  position: Position;
  targetItemId: string;
  targetItemType: TargetItemType;
  videoFilename: string;
  sourceStartTime: number;
  sourceEndTime: number;
  text: string;
  scene: string;
  profile: string;
  beatType: string;
}

export interface RegenerateChaptersInput {
  videoId: string;
  sections: Array<{ beforeClipId: string; title: string }>;
}

// ============================================================================
// Create Video From Selection Types
// ============================================================================

export type CreateVideoFromSelectionMode = "copy" | "move";

export interface CreateVideoFromSelectionInput {
  sourceVideoId: string;
  clipIds: string[];
  chapterIds: string[];
  title: string;
  mode: CreateVideoFromSelectionMode;
}

// ============================================================================
// Internal Input Types (for RPC events - use resolved InsertionPoint)
// ============================================================================

interface InternalAppendClipsInput {
  videoId: string;
  insertionPoint: InsertionPoint;
  clips: readonly {
    inputVideo: string;
    startTime: number;
    endTime: number;
  }[];
}

interface InternalAppendFromObsInput {
  videoId: string;
  filePath?: string;
  insertionPoint: InsertionPoint;
  pauseLength?: PauseLength;
}

interface InternalCreateChapterAtInsertionPointInput {
  videoId: string;
  name: string;
  insertionPoint: InsertionPoint;
}

// ============================================================================
// ClipService Interface
// ============================================================================

/**
 * The main ClipService interface. All methods return Promises.
 * No Effect.ts types are exposed to consumers.
 */
export interface ClipService {
  // Video fixture (primarily for tests)
  createVideo(path: string): Promise<Video>;

  // Timeline
  getTimeline(videoId: string): Promise<TimelineItem[]>;

  // Clip operations
  appendClips(input: AppendClipsInput): Promise<Clip[]>;
  appendFromObs(input: AppendFromObsInput): Promise<Clip[]>;
  archiveClips(clipIds: string[]): Promise<void>;
  unarchiveClips(clipIds: string[]): Promise<void>;
  updateClips(clips: UpdateClipInput[]): Promise<void>;
  updateBeat(clipId: string, beatType: string): Promise<void>;
  reorderClip(clipId: string, direction: ReorderDirection): Promise<void>;

  // Chapter operations
  createChapterAtInsertionPoint(
    input: CreateChapterAtInsertionPointInput
  ): Promise<Chapter>;
  createChapterAtPosition(
    input: CreateChapterAtPositionInput
  ): Promise<Chapter>;
  updateChapter(chapterId: string, name: string): Promise<void>;
  archiveChapters(chapterIds: string[]): Promise<void>;
  reorderChapter(chapterId: string, direction: ReorderDirection): Promise<void>;

  // Effect clip operations
  createEffectClipAtPosition(
    input: CreateEffectClipAtPositionInput
  ): Promise<Clip>;

  // Video creation from selection
  createVideoFromSelection(
    input: CreateVideoFromSelectionInput
  ): Promise<Video>;

  // AI-driven bulk replace of all Chapters on a Video
  regenerateChapters(
    input: RegenerateChaptersInput
  ): Promise<RegeneratedChapter[]>;
}

// ============================================================================
// RPC Event Types (Internal)
// ============================================================================

/**
 * Discriminated union of all ClipService operations.
 * This is an internal implementation detail - not exported to consumers.
 */
export type ClipServiceEvent =
  | { type: "create-video"; path: string }
  | { type: "get-timeline"; videoId: string }
  | { type: "append-clips"; input: InternalAppendClipsInput }
  | { type: "append-from-obs"; input: InternalAppendFromObsInput }
  | { type: "archive-clips"; clipIds: readonly string[] }
  | { type: "unarchive-clips"; clipIds: readonly string[] }
  | { type: "update-clips"; clips: readonly UpdateClipInput[] }
  | { type: "update-beat"; clipId: string; beatType: string }
  | { type: "reorder-clip"; clipId: string; direction: ReorderDirection }
  | {
      type: "create-chapter-at-insertion-point";
      input: InternalCreateChapterAtInsertionPointInput;
    }
  | {
      type: "create-chapter-at-position";
      input: CreateChapterAtPositionInput;
    }
  | { type: "update-chapter"; chapterId: string; name: string }
  | { type: "archive-chapters"; chapterIds: readonly string[] }
  | {
      type: "reorder-chapter";
      chapterId: string;
      direction: ReorderDirection;
    }
  | {
      type: "create-effect-clip-at-position";
      input: CreateEffectClipAtPositionInput;
    }
  | {
      type: "create-video-from-selection";
      input: CreateVideoFromSelectionInput;
    }
  | {
      type: "regenerate-chapters";
      input: RegenerateChaptersInput;
    };

// ============================================================================
// Transport Type
// ============================================================================

/**
 * Transport function signature. Takes an event, returns a Promise of the result.
 * HTTP transport sends to /clip-service route.
 * Direct transport calls handler directly.
 */
export type ClipServiceTransport = (
  event: ClipServiceEvent
) => Promise<unknown>;

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a ClipService instance using the provided transport.
 * This is the internal factory - consumers use createHttpClipService() or
 * createDirectClipService() instead.
 */
export function createClipService(send: ClipServiceTransport): ClipService {
  return {
    async createVideo(path) {
      return send({ type: "create-video", path }) as Promise<Video>;
    },

    async getTimeline(videoId) {
      return send({ type: "get-timeline", videoId }) as Promise<TimelineItem[]>;
    },

    async appendClips(input) {
      const resolved = resolveInsertionPoint(input.insertionPoint, input.items);
      return send({
        type: "append-clips",
        input: {
          videoId: input.videoId,
          insertionPoint: resolved,
          clips: input.clips,
        },
      }) as Promise<Clip[]>;
    },

    async appendFromObs(input) {
      const resolved = resolveInsertionPoint(input.insertionPoint, input.items);
      return send({
        type: "append-from-obs",
        input: {
          videoId: input.videoId,
          filePath: input.filePath,
          insertionPoint: resolved,
          pauseLength: input.pauseLength,
        },
      }) as Promise<Clip[]>;
    },

    async archiveClips(clipIds) {
      await send({ type: "archive-clips", clipIds });
    },

    async unarchiveClips(clipIds) {
      await send({ type: "unarchive-clips", clipIds });
    },

    async updateClips(clips) {
      await send({ type: "update-clips", clips });
    },

    async updateBeat(clipId, beatType) {
      await send({ type: "update-beat", clipId, beatType });
    },

    async reorderClip(clipId, direction) {
      await send({ type: "reorder-clip", clipId, direction });
    },

    async createChapterAtInsertionPoint(input) {
      const resolved = resolveInsertionPoint(input.insertionPoint, input.items);
      return send({
        type: "create-chapter-at-insertion-point",
        input: {
          videoId: input.videoId,
          name: input.name,
          insertionPoint: resolved,
        },
      }) as Promise<Chapter>;
    },

    async createChapterAtPosition(input) {
      return send({
        type: "create-chapter-at-position",
        input,
      }) as Promise<Chapter>;
    },

    async updateChapter(chapterId, name) {
      await send({ type: "update-chapter", chapterId, name });
    },

    async archiveChapters(chapterIds) {
      await send({ type: "archive-chapters", chapterIds });
    },

    async reorderChapter(chapterId, direction) {
      await send({ type: "reorder-chapter", chapterId, direction });
    },

    async createEffectClipAtPosition(input) {
      return send({
        type: "create-effect-clip-at-position",
        input,
      }) as Promise<Clip>;
    },

    async createVideoFromSelection(input) {
      return send({
        type: "create-video-from-selection",
        input,
      }) as Promise<Video>;
    },

    async regenerateChapters(input) {
      return send({
        type: "regenerate-chapters",
        input,
      }) as Promise<RegeneratedChapter[]>;
    },
  };
}

// ============================================================================
// HTTP Transport Factory (for frontend)
// ============================================================================

/**
 * Creates a ClipService that sends events to the /api/clip-service route.
 * This is the transport used in production by the frontend.
 */
export function createHttpClipService(): ClipService {
  const send = async (event: ClipServiceEvent): Promise<unknown> => {
    const response = await fetch("/api/clip-service", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ClipService request failed: ${response.status} ${text}`);
    }

    return response.json();
  };

  return createClipService(send);
}
