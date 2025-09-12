export interface Clip {
  id: string;
  videoFilename: string;
  sourceStartTime: number; // Start time in source video (seconds)
  sourceEndTime: number; // End time in source video (seconds)
  text: string;
}

export type ClipState = "playing" | "paused";

export interface State {
  clipIdsPreloaded: Set<string>;
  runningState: ClipState;
  clips: Clip[];
  currentClipId: string;
  currentTimeInClip: number;
  selectedClipsSet: Set<string>;
  playbackRate: number;
}

export type Effect = {
  type: "archive-clips";
  clipIds: string[];
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
      clipId: string;
      ctrlKey: boolean;
      shiftKey: boolean;
    }
  | {
      type: "update-clip-current-time";
      time: number;
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
      type: "press-home";
    }
  | {
      type: "press-end";
    }
  | {
      type: "press-k";
    }
  | {
      type: "clips-updated-from-props";
      clips: Clip[];
    };

const preloadSelectedClips = (state: State) => {
  const currentClipIndex = state.clips.findIndex(
    (clip) => clip.id === state.currentClipId
  );

  if (currentClipIndex === -1) {
    return state;
  }

  const nextClip = state.clips[currentClipIndex + 1];
  const nextNextClip = state.clips[currentClipIndex + 2];

  if (nextClip) {
    state.clipIdsPreloaded.add(nextClip.id);
  }
  if (nextNextClip) {
    state.clipIdsPreloaded.add(nextNextClip.id);
  }

  const newClipIdsPreloaded = state.clipIdsPreloaded
    .add(state.currentClipId)
    .union(state.selectedClipsSet);

  console.log(
    "preloadSelectedClips",
    newClipIdsPreloaded,
    nextClip,
    nextNextClip
  );

  return {
    ...state,
    clipIdsPreloaded: newClipIdsPreloaded,
  };
};

export const makeVideoEditorReducer =
  (reportEffect: (effect: Effect) => void) =>
  (state: State, action: Action): State => {
    switch (action.type) {
      case "clips-updated-from-props":
        return {
          ...state,
          clips: action.clips,
        };
      case "press-space-bar":
        return {
          ...state,
          runningState: state.runningState === "playing" ? "paused" : "playing",
        };
      case "press-home":
        const firstClip = state.clips[0];
        if (!firstClip) {
          return state;
        }
        return { ...state, selectedClipsSet: new Set([firstClip.id]) };
      case "press-end":
        const lastClip = state.clips[state.clips.length - 1];
        if (!lastClip) {
          return state;
        }
        return {
          ...state,
          selectedClipsSet: new Set([lastClip.id]),
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
          return state;
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

        return preloadSelectedClips({
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
          return preloadSelectedClips({
            ...state,
            selectedClipsSet: newSelectedClipsSet,
          });
        } else if (action.shiftKey) {
          const mostRecentClipId = Array.from(state.selectedClipsSet).pop();

          if (!mostRecentClipId) {
            return preloadSelectedClips({
              ...state,
              selectedClipsSet: new Set([action.clipId]),
            });
          }

          const mostRecentClipIndex = state.clips.findIndex(
            (clip) => clip.id === mostRecentClipId
          );

          if (mostRecentClipIndex === -1) {
            return state;
          }

          const newClipIndex = state.clips.findIndex(
            (clip) => clip.id === action.clipId
          );

          if (newClipIndex === -1) {
            return state;
          }
          const firstIndex = Math.min(mostRecentClipIndex, newClipIndex);
          const lastIndex = Math.max(mostRecentClipIndex, newClipIndex);

          const clipsBetweenMostRecentClipIndexAndNewClipIndex =
            state.clips.slice(firstIndex, lastIndex + 1);

          return preloadSelectedClips({
            ...state,
            selectedClipsSet: new Set(
              clipsBetweenMostRecentClipIndexAndNewClipIndex.map(
                (clip) => clip.id
              )
            ),
          });
        } else {
          if (state.selectedClipsSet.size > 1) {
            return preloadSelectedClips({
              ...state,
              selectedClipsSet: new Set([action.clipId]),
            });
          }

          if (state.selectedClipsSet.has(action.clipId)) {
            return preloadSelectedClips({
              ...state,
              currentClipId: action.clipId,
              runningState: "playing",
              currentTimeInClip: 0,
            });
          }
          return preloadSelectedClips({
            ...state,
            selectedClipsSet: new Set([action.clipId]),
          });
        }
      case "press-delete":
        const lastClipBeingDeletedIndex = state.clips.findLastIndex((clip) => {
          return state.selectedClipsSet.has(clip.id);
        });

        if (lastClipBeingDeletedIndex === -1) {
          return state;
        }

        const clipToMoveSelectionTo =
          state.clips[lastClipBeingDeletedIndex + 1];
        const backupClipToMoveSelectionTo =
          state.clips[lastClipBeingDeletedIndex - 1];
        const finalBackupClipToMoveSelectionTo = state.clips[0];

        const newSelectedClipId =
          clipToMoveSelectionTo?.id ??
          backupClipToMoveSelectionTo?.id ??
          finalBackupClipToMoveSelectionTo?.id;

        const newClips = state.clips.filter(
          (clip) => !state.selectedClipsSet.has(clip.id)
        );

        const isCurrentClipDeleted = state.selectedClipsSet.has(
          state.currentClipId
        );

        reportEffect({
          type: "archive-clips",
          clipIds: Array.from(state.selectedClipsSet),
        });

        return preloadSelectedClips({
          ...state,
          clips: newClips,
          selectedClipsSet: new Set(
            [newSelectedClipId].filter((id) => id !== undefined)
          ),
          runningState: isCurrentClipDeleted ? "paused" : state.runningState,
          currentClipId: isCurrentClipDeleted
            ? newSelectedClipId!
            : state.currentClipId,
        });
      case "update-clip-current-time":
        return { ...state, currentTimeInClip: action.time };
      case "clip-finished": {
        const currentClipIndex = state.clips.findIndex(
          (clip) => clip.id === state.currentClipId
        );

        if (currentClipIndex === -1) {
          return state;
        }

        const nextClip = state.clips[currentClipIndex + 1];
        const nextNextClip = state.clips[currentClipIndex + 2];

        const newClipIdsPreloaded = state.clipIdsPreloaded;

        if (nextClip) {
          newClipIdsPreloaded.add(nextClip.id);
        }

        if (nextNextClip) {
          newClipIdsPreloaded.add(nextNextClip.id);
        }

        if (nextClip) {
          return {
            ...state,
            currentClipId: nextClip.id,
            clipIdsPreloaded: newClipIdsPreloaded,
          };
        } else {
          return { ...state, runningState: "paused" };
        }
      }
      case "press-arrow-up":
      case "press-arrow-left": {
        if (state.selectedClipsSet.size === 0) {
          return preloadSelectedClips({
            ...state,
            selectedClipsSet: new Set([state.currentClipId]),
          });
        }

        const mostRecentClipId = Array.from(state.selectedClipsSet).pop()!;

        const currentClipIndex = state.clips.findIndex(
          (clip) => clip.id === mostRecentClipId
        );
        const previousClip = state.clips[currentClipIndex - 1];
        if (previousClip) {
          return preloadSelectedClips({
            ...state,
            selectedClipsSet: new Set([previousClip.id]),
          });
        } else {
          return state;
        }
      }
      case "press-arrow-down":
      case "press-arrow-right": {
        if (state.selectedClipsSet.size === 0) {
          return preloadSelectedClips({
            ...state,
            selectedClipsSet: new Set([state.currentClipId]),
          });
        }

        const mostRecentClipId = Array.from(state.selectedClipsSet).pop()!;

        const currentClipIndex = state.clips.findIndex(
          (clip) => clip.id === mostRecentClipId
        );
        const nextClip = state.clips[currentClipIndex + 1];
        if (nextClip) {
          return preloadSelectedClips({
            ...state,
            selectedClipsSet: new Set([nextClip.id]),
          });
        } else {
          return state;
        }
      }
    }
    action satisfies never;
  };
