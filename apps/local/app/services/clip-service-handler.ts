/**
 * ClipService Handler
 *
 * This file contains the handler function that processes ClipServiceEvents
 * and the direct transport factory for testing.
 *
 * The handler pattern-matches on the event type and dispatches to the
 * appropriate database operations.
 */

import { videos } from "@/db/schema";
import { Effect } from "effect";
import { getFootageStats } from "@cvm/core/services/db-footage-stats.server";
import { type ClipServiceEvent, type TimelineItem } from "./clip-service";
import {
  archiveClips,
  unarchiveClips,
  updateClips,
  updatePause,
  updateClipText,
  updateZoom,
} from "./clip-service-clips.server";
import {
  createChapterAtInsertionPoint,
  createChapterAtPosition,
  updateChapter,
  archiveChapters,
} from "./clip-service-chapters.server";
import { reorderClip, reorderChapter } from "./clip-service-reorder.server";
import { updateSceneOverride } from "./clip-service-scene-override.server";
import {
  updateMicEq,
  updateMicOffset,
} from "./clip-service-mic-settings.server";
import {
  type LoggerAdapter,
  noopLogger,
  getOrderedItems,
  touchVideoUpdatedAt,
  appendClipsAtInsertionPoint,
  dbCall,
  createEffectClipAtPositionImpl,
  handleCreateVideoFromSelection,
} from "./clip-service-handler.helpers";
import type { Database } from "@/services/drizzle-service.server";
import { withClipServiceWriteClosure } from "./draft-guard-clip-service.server";
import { replaceVideoChapters } from "./autofill-chapters-write.server";
import { toDate } from "@/packages/clock";

export type { LoggerAdapter };

// ============================================================================
// Handler
// ============================================================================

/**
 * Handles a ClipServiceEvent by dispatching to the appropriate database operation.
 * This is the core business logic that both HTTP and direct transports use.
 *
 * Write-closure (issues #1348/#1403): guarded write events dispatch inside one
 * transaction holding the owning version row FOR UPDATE, so the draft check
 * and the write commit atomically (see draft-guard.server.ts).
 *
 * @param db - Drizzle database instance
 * @param event - The event to handle
 */
export const handleClipServiceEvent = (
  db: Database,
  event: ClipServiceEvent,
  logger: LoggerAdapter = noopLogger
) =>
  withClipServiceWriteClosure(db, event, (tx) =>
    dispatchClipServiceEvent(tx, event, logger)
  );

const dispatchClipServiceEvent = Effect.fn("dispatchClipServiceEvent")(
  function* (db: Database, event: ClipServiceEvent, logger: LoggerAdapter) {
    switch (event.type) {
      case "create-video": {
        const [video] = yield* dbCall(() =>
          db
            .insert(videos)
            .values({
              title: event.title,
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

      case "get-footage-stats": {
        return yield* getFootageStats(db, {
          now: toDate(event.now),
          timeZone: event.timeZone,
        });
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

      case "archive-clips":
        return yield* archiveClips(db, logger, event);

      case "unarchive-clips":
        return yield* unarchiveClips(db, logger, event);

      case "update-clips":
        return yield* updateClips(db, logger, event);

      case "update-pause":
        return yield* updatePause(db, logger, event);

      case "update-clip-text":
        return yield* updateClipText(db, logger, event);

      case "update-zoom":
        return yield* updateZoom(db, logger, event);

      case "update-scene-override":
        return yield* updateSceneOverride(db, logger, event);

      case "update-mic-offset":
        return yield* updateMicOffset(db, logger, event);

      case "update-mic-eq":
        return yield* updateMicEq(db, event);

      case "reorder-clip":
        return yield* reorderClip(db, logger, event);

      case "create-chapter-at-insertion-point":
        return yield* createChapterAtInsertionPoint(db, logger, event);

      case "create-chapter-at-position":
        return yield* createChapterAtPosition(db, logger, event);

      case "update-chapter":
        return yield* updateChapter(db, logger, event);

      case "archive-chapters":
        return yield* archiveChapters(db, logger, event);

      case "reorder-chapter":
        return yield* reorderChapter(db, logger, event);

      case "create-effect-clip-at-position": {
        return yield* createEffectClipAtPositionImpl(db, event.input, logger);
      }

      case "create-video-from-selection": {
        return yield* handleCreateVideoFromSelection(db, event.input, logger);
      }

      case "autofill-chapters": {
        const { videoId, sections: proposed } = event.input;

        const inserted = yield* dbCall(() =>
          replaceVideoChapters(db, { videoId, proposals: proposed })
        );

        logger.log(videoId, {
          type: "chapters-autofilled",
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

export {
  placeSpeechAsClips,
  type PlaceSpeechAsClipsInput,
  type SpeechSegment,
} from "./clip-service-speech.server";
