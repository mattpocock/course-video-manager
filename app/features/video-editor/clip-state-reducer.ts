import type { BeatType } from "@/services/video-processing-service";
import type { EffectReducer } from "use-effect-reducer";
export * from "./clip-state-reducer.types";
import type {
  Clip,
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  ClipReducerAction,
  ClipReducerEffect,
  ClipReducerState,
  DatabaseId,
  FrontendInsertionPoint,
} from "./clip-state-reducer.types";
import { archiveClips } from "./clip-state-reducer.helpers";
import { handleAddEffectClipAt } from "./clip-state-reducer-effect-clip-helpers";
import {
  handleRecordingAction,
  isRecordingAction,
} from "./clip-state-reducer-recording";
import {
  handleChapterAction,
  isChapterAction,
} from "./clip-state-reducer-chapters";

export namespace clipStateReducer {
  export type State = ClipReducerState;
  export type Action = ClipReducerAction;
  export type Effect = ClipReducerEffect;
}

export const clipStateReducer: EffectReducer<
  clipStateReducer.State,
  clipStateReducer.Action,
  clipStateReducer.Effect
> = (
  state: clipStateReducer.State,
  action: clipStateReducer.Action,
  exec
): clipStateReducer.State => {
  if (isRecordingAction(action)) {
    return handleRecordingAction(state, action, exec);
  }

  if (isChapterAction(action)) {
    return handleChapterAction(state, action, exec);
  }

  switch (action.type) {
    case "clips-deleted": {
      const { items, clipsToArchive, chaptersToArchive, insertionPoint } =
        archiveClips(state.items, action.clipIds, state.insertionPoint);

      if (clipsToArchive.size > 0) {
        exec({
          type: "archive-clips",
          clipIds: Array.from(clipsToArchive),
        });
      }
      if (chaptersToArchive.size > 0) {
        exec({
          type: "archive-chapters",
          chapterIds: Array.from(chaptersToArchive),
        });
      }
      return {
        ...state,
        items,
        insertionPoint: insertionPoint,
      };
    }
    case "clips-retranscribing": {
      const newSet = new Set([...state.clipIdsBeingTranscribed]);
      for (const clipId of action.clipIds) {
        newSet.add(clipId);
      }
      return {
        ...state,
        clipIdsBeingTranscribed: newSet,
      };
    }
    case "clips-transcribed": {
      const set = new Set([...state.clipIdsBeingTranscribed]);

      const textMap: Record<DatabaseId, string> = action.clips.reduce(
        (acc, clip) => {
          acc[clip.databaseId] = clip.text;
          return acc;
        },
        {} as Record<DatabaseId, string>
      );

      return {
        ...state,
        items: state.items.map((item) => {
          if (item.type === "on-database" && textMap[item.databaseId]) {
            set.delete(item.frontendId);
            return { ...item, text: textMap[item.databaseId]! };
          }
          return item;
        }),
        clipIdsBeingTranscribed: set,
      };
    }
    case "set-insertion-point-after": {
      const item = state.items.find((c) => c.frontendId === action.clipId);
      if (!item) {
        return state;
      }

      // Set insertion point based on item type
      let insertionPoint: FrontendInsertionPoint;
      if (item.type === "on-database" || item.type === "optimistically-added") {
        insertionPoint = {
          type: "after-clip",
          frontendClipId: action.clipId,
        };
      } else {
        insertionPoint = {
          type: "after-chapter",
          frontendChapterId: action.clipId,
        };
      }

      return {
        ...state,
        insertionPoint,
      };
    }
    case "set-insertion-point-before": {
      const item = state.items.find((c) => c.frontendId === action.clipId);
      if (!item) {
        return state;
      }

      // If inserting before, we need to find the previous item's frontendId
      // to use as insertAfterId, OR use INSERTION_POINT_START if this is first item
      const itemIndex = state.items.findIndex(
        (c) => c.frontendId === action.clipId
      );

      let insertionPoint: FrontendInsertionPoint;
      if (itemIndex === 0) {
        // First item - use start
        insertionPoint = { type: "start" };
      } else {
        // Not first item - use previous item's frontendId based on its type
        const previousItem = state.items[itemIndex - 1];

        if (previousItem) {
          if (
            previousItem.type === "on-database" ||
            previousItem.type === "optimistically-added"
          ) {
            insertionPoint = {
              type: "after-clip",
              frontendClipId: previousItem.frontendId,
            };
          } else {
            insertionPoint = {
              type: "after-chapter",
              frontendChapterId: previousItem.frontendId,
            };
          }
        } else {
          throw new Error("Previous item not found when inserting before");
        }
      }

      return {
        ...state,
        insertionPoint,
      };
    }
    case "delete-latest-inserted-clip": {
      if (state.insertionPoint.type === "start") {
        return state;
      }

      if (state.insertionPoint.type === "end") {
        // Skip clips already marked for archive so repeated stream deck
        // presses continue deleting backwards through the timeline
        const lastClip = state.items.findLast(
          (c) => !("shouldArchive" in c && c.shouldArchive)
        );

        if (!lastClip) {
          return state;
        }
        const { items, clipsToArchive, chaptersToArchive, insertionPoint } =
          archiveClips(
            state.items,
            [lastClip.frontendId],
            state.insertionPoint
          );

        if (clipsToArchive.size > 0) {
          exec({
            type: "archive-clips",
            clipIds: Array.from(clipsToArchive),
          });
        }
        if (chaptersToArchive.size > 0) {
          exec({
            type: "archive-chapters",
            chapterIds: Array.from(chaptersToArchive),
          });
        }

        return {
          ...state,
          items,
          insertionPoint,
        };
      }

      const clipIdToArchive =
        state.insertionPoint.type === "after-clip"
          ? state.insertionPoint.frontendClipId
          : state.insertionPoint.frontendChapterId;

      const archiveResult = archiveClips(
        state.items,
        [clipIdToArchive],
        state.insertionPoint
      );

      if (archiveResult.clipsToArchive.size > 0) {
        exec({
          type: "archive-clips",
          clipIds: Array.from(archiveResult.clipsToArchive),
        });
      }
      if (archiveResult.chaptersToArchive.size > 0) {
        exec({
          type: "archive-chapters",
          chapterIds: Array.from(archiveResult.chaptersToArchive),
        });
      }

      return {
        ...state,
        items: archiveResult.items,
        insertionPoint: archiveResult.insertionPoint,
      };
    }
    case "toggle-beat-at-insertion-point": {
      // Find the clip at the insertion point (similar to delete-latest-inserted-clip)
      let clipToToggle: Clip | undefined;

      if (state.insertionPoint.type === "start") {
        // No clip before start
        return state;
      }

      if (state.insertionPoint.type === "end") {
        const lastItem = state.items[state.items.length - 1];
        if (
          lastItem &&
          (lastItem.type === "on-database" ||
            lastItem.type === "optimistically-added")
        ) {
          clipToToggle = lastItem;
        }
      } else if (state.insertionPoint.type === "after-clip") {
        const targetFrontendId = state.insertionPoint.frontendClipId;
        const item = state.items.find((c) => c.frontendId === targetFrontendId);
        if (
          item &&
          (item.type === "on-database" || item.type === "optimistically-added")
        ) {
          clipToToggle = item;
        }
      } else if (state.insertionPoint.type === "after-chapter") {
        // Don't toggle beat for chapters
        return state;
      }

      if (!clipToToggle) {
        return state;
      }

      const newBeatType: BeatType =
        clipToToggle.beatType === "none" ? "long" : "none";

      // If it's a database clip, fire an effect to update the DB
      if (clipToToggle.type === "on-database") {
        exec({
          type: "update-beat",
          clipId: clipToToggle.databaseId,
          beatType: newBeatType,
        });
      }

      return {
        ...state,
        items: state.items.map((item) =>
          item.frontendId === clipToToggle!.frontendId &&
          (item.type === "on-database" || item.type === "optimistically-added")
            ? { ...item, beatType: newBeatType }
            : item
        ),
      };
    }
    case "toggle-beat-for-clip": {
      const item = state.items.find((c) => c.frontendId === action.clipId);

      if (
        !item ||
        (item.type !== "on-database" && item.type !== "optimistically-added")
      ) {
        return state;
      }

      const clipToToggle = item;
      const newBeatType: BeatType =
        clipToToggle.beatType === "none" ? "long" : "none";

      // If it's a database clip, fire an effect to update the DB
      if (clipToToggle.type === "on-database") {
        exec({
          type: "update-beat",
          clipId: clipToToggle.databaseId,
          beatType: newBeatType,
        });
      }

      return {
        ...state,
        items: state.items.map((item) =>
          item.frontendId === action.clipId &&
          (item.type === "on-database" || item.type === "optimistically-added")
            ? { ...item, beatType: newBeatType }
            : item
        ),
      };
    }
    case "move-clip": {
      const clipIndex = state.items.findIndex(
        (c) => c.frontendId === action.clipId
      );

      if (clipIndex === -1) {
        return state;
      }

      const item = state.items[clipIndex]!;
      const targetIndex =
        action.direction === "up" ? clipIndex - 1 : clipIndex + 1;

      // Check boundaries
      if (targetIndex < 0 || targetIndex >= state.items.length) {
        return state;
      }

      // Swap items in the array
      const newItems = [...state.items];
      newItems[clipIndex] = newItems[targetIndex]!;
      newItems[targetIndex] = item;

      // Fire effect to update database based on item type
      if (item.type === "on-database") {
        exec({
          type: "reorder-clip",
          clipId: item.databaseId,
          direction: action.direction,
        });
      } else if (item.type === "chapter-on-database") {
        exec({
          type: "reorder-chapter",
          chapterId: item.databaseId,
          direction: action.direction,
        });
      }

      return {
        ...state,
        items: newItems,
      };
    }
    case "add-effect-clip-at":
      return handleAddEffectClipAt(state, action, exec);
    case "effect-clip-created": {
      return {
        ...state,
        items: state.items.map((item) => {
          if (
            item.frontendId === action.frontendId &&
            item.type === "effect-clip-optimistically-added"
          ) {
            const onDatabase: ClipOnDatabase = {
              type: "on-database",
              frontendId: item.frontendId,
              databaseId: action.databaseId,
              videoFilename: item.videoFilename,
              sourceStartTime: item.sourceStartTime,
              sourceEndTime: item.sourceEndTime,
              text: item.text,
              transcribedAt: new Date(),
              scene: item.scene,
              profile: item.profile,
              insertionOrder: item.insertionOrder,
              beatType: item.beatType,
              diagramSnapshotId: null,
              diagramName: null,
            };
            return onDatabase;
          }
          return item;
        }),
      };
    }
    case "restore-clip": {
      const item = state.items.find((c) => c.frontendId === action.clipId);

      if (!item) {
        return state;
      }

      // Only restore clips that have shouldArchive
      if (
        (item.type !== "optimistically-added" && item.type !== "on-database") ||
        !item.shouldArchive
      ) {
        return state;
      }

      // Fire unarchive-clips effect for resolved (database) clips
      if (item.type === "on-database") {
        exec({
          type: "unarchive-clips",
          clipIds: [item.databaseId],
        });
      }

      return {
        ...state,
        items: state.items.map((c) => {
          if (c.frontendId === action.clipId) {
            const { shouldArchive, ...rest } = c as
              | ClipOnDatabase
              | ClipOptimisticallyAdded;
            return rest;
          }
          return c;
        }),
      };
    }
    case "permanently-remove-archived": {
      const itemsToRemove = state.items.filter((item) => {
        if (
          item.type === "optimistically-added" &&
          (item.shouldArchive || item.isOrphaned) &&
          item.sessionId === action.sessionId
        ) {
          return true;
        }
        if (
          item.type === "on-database" &&
          item.shouldArchive &&
          item.sessionId === action.sessionId
        ) {
          return true;
        }
        return false;
      });

      if (itemsToRemove.length === 0) {
        return state;
      }

      const idsToRemove = new Set(itemsToRemove.map((i) => i.frontendId));

      return {
        ...state,
        items: state.items.filter((item) => !idsToRemove.has(item.frontendId)),
      };
    }
    case "permanently-remove-all-archived": {
      const itemsToRemove = state.items.filter((item) => {
        if (
          item.type === "optimistically-added" &&
          (item.shouldArchive || item.isOrphaned)
        ) {
          return true;
        }
        if (item.type === "on-database" && item.shouldArchive) {
          return true;
        }
        return false;
      });

      if (itemsToRemove.length === 0) {
        return state;
      }

      const idsToRemove = new Set(itemsToRemove.map((i) => i.frontendId));

      return {
        ...state,
        items: state.items.filter((item) => !idsToRemove.has(item.frontendId)),
      };
    }
    case "effect-failed": {
      return {
        ...state,
        error: {
          message: action.message,
          effectType: action.effectType,
          timestamp: Date.now(),
        },
      };
    }
    case "update-clip-diagram-pin": {
      return {
        ...state,
        items: state.items.map((item) => {
          if (
            item.frontendId === action.clipId &&
            item.type === "on-database"
          ) {
            return {
              ...item,
              diagramSnapshotId: action.diagramSnapshotId,
              diagramName: action.diagramName,
            };
          }
          return item;
        }),
      };
    }
  }
  return state;
};
