import type { EffectReducer } from "use-effect-reducer";
export * from "./clip-state-reducer.types";
import type {
  ClipReducerAction,
  ClipReducerEffect,
  ClipReducerState,
} from "./clip-state-reducer.types";
import {
  applyTranscriptionJobEvent,
  followJoinedJob,
  requestClipTranscription,
} from "./clip-state-reducer-transcription-jobs";
import { handleAddEffectClipAt } from "./clip-state-reducer-effect-clip-helpers";
import {
  handleRecordingAction,
  isRecordingAction,
} from "./clip-state-reducer-recording";
import {
  handleChapterAction,
  isChapterAction,
} from "./clip-state-reducer-chapters";
import { handleSetSceneOverride } from "./clip-state-reducer-scene-override";
import {
  handleMicOffsetSaveFailed,
  handleMicSettingsSubmitted,
} from "./clip-state-reducer-mic-settings";
import {
  handleClipRestoreFailed,
  handleRestoreClip,
} from "./clip-state-reducer-restore";
import {
  handleClipsDeleted,
  handleDeleteLatestInsertedClip,
  handlePermanentlyRemoveAllArchived,
  handlePermanentlyRemoveArchived,
} from "./clip-state-reducer-archive";
import {
  handleClipTextEdited,
  handleEffectClipCreated,
  handleMoveClip,
  handleSetInsertionPointAfter,
  handleSetInsertionPointBefore,
  handleTogglePauseAtInsertionPoint,
  handleTogglePauseForClip,
  handleToggleZoomForClip,
} from "./clip-state-reducer-timeline";

export namespace clipStateReducer {
  export type State = ClipReducerState;
  export type Action = ClipReducerAction;
  export type Effect = ClipReducerEffect;
}

export const clipStateReducer: EffectReducer<
  clipStateReducer.State,
  clipStateReducer.Action,
  clipStateReducer.Effect
> = (state, action, exec) => {
  if (action.type === "set-scene-override") {
    return handleSetSceneOverride(state, action, exec);
  }

  if (action.type === "mic-settings-submitted") {
    return handleMicSettingsSubmitted(state, action, exec);
  }

  if (action.type === "mic-offset-save-failed") {
    return handleMicOffsetSaveFailed(state, action);
  }

  if (action.type === "mic-offset-refusal-dismissed") {
    return { ...state, micOffsetRefusal: null };
  }

  if (isRecordingAction(action)) {
    return handleRecordingAction(state, action, exec);
  }

  if (isChapterAction(action)) {
    return handleChapterAction(state, action, exec);
  }

  switch (action.type) {
    case "clips-deleted":
      return handleClipsDeleted(state, action, exec);
    case "clips-retranscribing":
      return requestClipTranscription(
        state,
        action.clipIds,
        action.jobId,
        exec
      );
    case "transcription-job-joined":
      return followJoinedJob(state, action.requestedJobId, action.jobId);
    case "job-event-heard":
      return applyTranscriptionJobEvent(state, action.heard);
    case "set-insertion-point-after":
      return handleSetInsertionPointAfter(state, action);
    case "set-insertion-point-before":
      return handleSetInsertionPointBefore(state, action);
    case "delete-latest-inserted-clip":
      return handleDeleteLatestInsertedClip(state, exec);
    case "toggle-pause-at-insertion-point":
      return handleTogglePauseAtInsertionPoint(state, exec);
    case "toggle-pause-for-clip":
      return handleTogglePauseForClip(state, action, exec);
    case "clip-text-edited":
      return handleClipTextEdited(state, action, exec);
    case "toggle-zoom-for-clip":
      return handleToggleZoomForClip(state, action, exec);
    case "move-clip":
      return handleMoveClip(state, action, exec);
    case "add-effect-clip-at":
      return handleAddEffectClipAt(state, action, exec);
    case "effect-clip-created":
      return handleEffectClipCreated(state, action);
    case "restore-clip":
      return handleRestoreClip(state, action, exec);
    case "clip-restore-failed":
      return handleClipRestoreFailed(state, action);
    case "permanently-remove-archived":
      return handlePermanentlyRemoveArchived(state, action);
    case "permanently-remove-all-archived":
      return handlePermanentlyRemoveAllArchived(state);
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
    case "set-clip-web-links": {
      return {
        ...state,
        items: state.items.map((item) => {
          if (
            item.type === "on-database" &&
            item.databaseId === action.clipId
          ) {
            return { ...item, webLinks: action.webLinks };
          }
          return item;
        }),
      };
    }
    case "remove-clip-web-link": {
      exec({
        type: "delete-web-link",
        clipId: action.clipId,
        linkId: action.linkId,
      });
      return {
        ...state,
        items: state.items.map((item) => {
          if (
            item.type === "on-database" &&
            item.frontendId === action.clipId
          ) {
            return {
              ...item,
              webLinks: item.webLinks.filter((l) => l.id !== action.linkId),
            };
          }
          return item;
        }),
      };
    }
  }
  return state;
};
