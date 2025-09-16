import type { FrontendId } from "./clip-state-reducer";

export type RunningState = "playing" | "paused";

export interface State {
  clipIdsPreloaded: Set<FrontendId>;
  runningState: RunningState;
  currentClipId: FrontendId | undefined;
  currentTimeInClip: number;
  selectedClipsSet: Set<FrontendId>;
  playbackRate: number;
  forceViewTimeline: boolean;
}

export type Effect = {
  type: "archive-clips";
  clipIds: FrontendId[];
};

export type Action =
  | {
      type: "press-pause";
    }
  | {
      type: "press-play";
    }
  | {
      type: "click-clip";
      clipId: FrontendId;
      ctrlKey: boolean;
      shiftKey: boolean;
    }
  | {
      type: "update-clip-current-time";
      time: number;
    }
  | {
      type: "delete-last-clip";
    }
  | {
      type: "clip-finished";
    }
  | {
      type: "press-delete";
    }
  | {
      type: "press-space-bar";
    }
  | {
      type: "press-return";
    }
  | {
      type: "press-arrow-left";
    }
  | {
      type: "press-arrow-right";
    }
  | {
      type: "press-arrow-up";
    }
  | {
      type: "press-arrow-down";
    }
  | {
      type: "press-l";
    }
  | {
      type: "keydown-v";
    }
  | {
      type: "keyup-v";
    }
  | {
      type: "press-home";
    }
  | {
      type: "press-end";
    }
  | {
      type: "press-k";
    };

const preloadSelectedClips = (clipIds: FrontendId[], state: State): State => {
  if (!state.currentClipId) {
    return state;
  }

  const currentClipIndex = clipIds.findIndex(
    (clipId) => clipId === state.currentClipId
  );

  if (currentClipIndex === -1) {
    return state;
  }

  const nextClip = clipIds[currentClipIndex + 1];
  const nextNextClip = clipIds[currentClipIndex + 2];

  if (nextClip) {
    state.clipIdsPreloaded.add(nextClip);
  }
  if (nextNextClip) {
    state.clipIdsPreloaded.add(nextNextClip);
  }

  const newClipIdsPreloaded = state.clipIdsPreloaded
    .add(state.currentClipId)
    .union(state.selectedClipsSet);

  return {
    ...state,
    clipIdsPreloaded: newClipIdsPreloaded,
  };
};

export const makeVideoEditorReducer =
  (reportEffect: (effect: Effect) => void, clipIds: FrontendId[]) =>
  (state: State, action: Action): State => {
    switch (action.type) {
      case "keydown-v":
        return { ...state, forceViewTimeline: true };
      case "keyup-v":
        return { ...state, forceViewTimeline: false };
      case "press-space-bar":
        return {
          ...state,
          runningState: state.runningState === "playing" ? "paused" : "playing",
        };
      case "press-home":
        const firstClip = clipIds[0];
        if (!firstClip) {
          return state;
        }
        return { ...state, selectedClipsSet: new Set([firstClip]) };
      case "press-end":
        const lastClip = clipIds[clipIds.length - 1];
        if (!lastClip) {
          return state;
        }
        return {
          ...state,
          selectedClipsSet: new Set([lastClip]),
        };
      case "press-l":
        if (state.playbackRate === 2) {
          return {
            ...state,
            playbackRate: 2,
            runningState:
              state.runningState === "playing" ? "paused" : "playing",
          };
        }
        return { ...state, playbackRate: 2, runningState: "playing" };
      case "press-k":
        if (state.playbackRate === 1) {
          return {
            ...state,
            playbackRate: 1,
            runningState:
              state.runningState === "playing" ? "paused" : "playing",
          };
        }
        return { ...state, playbackRate: 1, runningState: "playing" };
      case "press-pause":
        return { ...state, runningState: "paused" };
      case "press-play":
        return { ...state, runningState: "playing" };
      case "press-return":
        if (state.selectedClipsSet.size === 0) {
          return {
            ...state,
            runningState:
              state.runningState === "playing" ? "paused" : "playing",
          };
        }
        const mostRecentClipId = Array.from(state.selectedClipsSet).pop()!;

        if (state.currentClipId === mostRecentClipId) {
          return {
            ...state,
            selectedClipsSet: new Set([state.currentClipId]),
            runningState:
              state.runningState === "playing" ? "paused" : "playing",
          };
        }

        return preloadSelectedClips(clipIds, {
          ...state,
          currentClipId: mostRecentClipId,
          runningState: "playing",
          currentTimeInClip: 0,
          selectedClipsSet: new Set([mostRecentClipId]),
        });
      case "click-clip":
        if (action.ctrlKey) {
          const newSelectedClipsSet = new Set(state.selectedClipsSet);
          if (newSelectedClipsSet.has(action.clipId)) {
            newSelectedClipsSet.delete(action.clipId);
          } else {
            newSelectedClipsSet.add(action.clipId);
          }
          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: newSelectedClipsSet,
          });
        } else if (action.shiftKey) {
          const mostRecentClipId = Array.from(state.selectedClipsSet).pop();

          if (!mostRecentClipId) {
            return preloadSelectedClips(clipIds, {
              ...state,
              selectedClipsSet: new Set([action.clipId]),
            });
          }

          const mostRecentClipIndex = clipIds.findIndex(
            (clipId) => clipId === mostRecentClipId
          );

          if (mostRecentClipIndex === -1) {
            return state;
          }

          const newClipIndex = clipIds.findIndex(
            (clipId) => clipId === action.clipId
          );

          if (newClipIndex === -1) {
            return state;
          }
          const firstIndex = Math.min(mostRecentClipIndex, newClipIndex);
          const lastIndex = Math.max(mostRecentClipIndex, newClipIndex);

          const clipsBetweenMostRecentClipIndexAndNewClipIndex = clipIds.slice(
            firstIndex,
            lastIndex + 1
          );

          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: new Set(
              clipsBetweenMostRecentClipIndexAndNewClipIndex.map((clip) => clip)
            ),
          });
        } else {
          if (state.selectedClipsSet.size > 1) {
            return preloadSelectedClips(clipIds, {
              ...state,
              selectedClipsSet: new Set([action.clipId]),
            });
          }

          if (state.selectedClipsSet.has(action.clipId)) {
            return preloadSelectedClips(clipIds, {
              ...state,
              currentClipId: action.clipId,
              runningState: "playing",
              currentTimeInClip: 0,
            });
          }
          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: new Set([action.clipId]),
          });
        }
      case "press-delete":
        const lastClipBeingDeletedIndex = clipIds.findLastIndex((clipId) => {
          return state.selectedClipsSet.has(clipId);
        });

        if (lastClipBeingDeletedIndex === -1) {
          return state;
        }

        const clipToMoveSelectionTo = clipIds[lastClipBeingDeletedIndex + 1];
        const backupClipToMoveSelectionTo =
          clipIds[lastClipBeingDeletedIndex - 1];
        const finalBackupClipToMoveSelectionTo = clipIds[0];

        const newSelectedClipId =
          clipToMoveSelectionTo ??
          backupClipToMoveSelectionTo ??
          finalBackupClipToMoveSelectionTo;

        const isCurrentClipDeleted =
          state.currentClipId &&
          state.selectedClipsSet.has(state.currentClipId);

        reportEffect({
          type: "archive-clips",
          clipIds: Array.from(state.selectedClipsSet),
        });

        return preloadSelectedClips(clipIds, {
          ...state,
          selectedClipsSet: new Set(
            [newSelectedClipId].filter((id) => id !== undefined)
          ),
          runningState: isCurrentClipDeleted ? "paused" : state.runningState,
          currentClipId: isCurrentClipDeleted
            ? newSelectedClipId!
            : state.currentClipId,
        });

      case "delete-last-clip": {
        const lastClipId = clipIds[clipIds.length - 1];
        if (!lastClipId) {
          return state;
        }

        reportEffect({
          type: "archive-clips",
          clipIds: [lastClipId],
        });

        return state;
      }
      case "update-clip-current-time":
        return { ...state, currentTimeInClip: action.time };
      case "clip-finished": {
        const currentClipIndex = clipIds.findIndex(
          (clipId) => clipId === state.currentClipId
        );

        if (currentClipIndex === -1) {
          return state;
        }

        const nextClip = clipIds[currentClipIndex + 1];
        const nextNextClip = clipIds[currentClipIndex + 2];

        const newClipIdsPreloaded = state.clipIdsPreloaded;

        if (nextClip) {
          newClipIdsPreloaded.add(nextClip);
        }

        if (nextNextClip) {
          newClipIdsPreloaded.add(nextNextClip);
        }

        if (nextClip) {
          return {
            ...state,
            currentClipId: nextClip,
            clipIdsPreloaded: newClipIdsPreloaded,
          };
        } else {
          return { ...state, runningState: "paused" };
        }
      }
      case "press-arrow-up":
      case "press-arrow-left": {
        if (state.selectedClipsSet.size === 0 && state.currentClipId) {
          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: new Set([state.currentClipId]),
          });
        }

        const mostRecentClipId = Array.from(state.selectedClipsSet).pop()!;

        const currentClipIndex = clipIds.findIndex(
          (clipId) => clipId === mostRecentClipId
        );
        const previousClip = clipIds[currentClipIndex - 1];
        if (previousClip) {
          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: new Set([previousClip]),
          });
        } else {
          return state;
        }
      }
      case "press-arrow-down":
      case "press-arrow-right": {
        if (state.selectedClipsSet.size === 0 && state.currentClipId) {
          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: new Set([state.currentClipId]),
          });
        }

        const mostRecentClipId = Array.from(state.selectedClipsSet).pop()!;

        const currentClipIndex = clipIds.findIndex(
          (clipId) => clipId === mostRecentClipId
        );
        const nextClip = clipIds[currentClipIndex + 1];
        if (nextClip) {
          return preloadSelectedClips(clipIds, {
            ...state,
            selectedClipsSet: new Set([nextClip]),
          });
        } else {
          return state;
        }
      }
    }
    action satisfies never;
  };
