import type { EffectReducer } from "use-effect-reducer";
import { preloadedAround } from "./preloaded-clips";
import type { FrontendId } from "./clip-state-reducer";
import {
  isDroppedWithoutReplay,
  isKeyOwnedByAnimatic,
  reduceAnimatic,
  type AnimaticAction,
  type AnimaticEffect,
  type AnimaticOwner,
} from "./video-state-reducer-animatic";

export type RunningState = "playing" | "paused";

export namespace videoStateReducer {
  export interface State {
    clipIdsPreloaded: Set<FrontendId>;
    runningState: RunningState;
    currentClipId: FrontendId | undefined;
    currentTimeInClip: number;
    selectedClipsSet: Set<FrontendId>;
    playbackRate: number;
    /**
     * Whether to show the last frame of the video.
     */
    showLastFrameOfVideo: boolean;
    /**
     * When set, the preview video should seek to this absolute time
     * in the source footage. Used for frame-by-frame scrubbing.
     */
    scrubSeekTime: number | undefined;
    /** The Animatic player open over the editor, owning the keys. */
    animatic: AnimaticOwner;
    /**
     * Whether this layout plays Clips back. The Streaming tab's does not: no
     * key or teleprompter mark plays a Clip or edits the timeline there.
     */
    replay: boolean;
  }

  export type Effect =
    | AnimaticEffect
    | {
        type: "archive-clips";
        clipIds: FrontendId[];
      }
    | {
        type: "retranscribe-clips";
        clipIds: FrontendId[];
      }
    | {
        type: "toggle-pause-for-clip";
        clipId: FrontendId;
      }
    | {
        type: "toggle-zoom-for-clip";
        clipId: FrontendId;
      }
    | {
        type: "move-clip";
        clipId: FrontendId;
        direction: "up" | "down";
      }
    | {
        type: "create-video-from-selection";
        clipIds: FrontendId[];
        chapterIds: FrontendId[];
        title: string;
        mode: "copy" | "move";
      };

  export type Action =
    | AnimaticAction
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
        type: "toggle-last-frame-of-video";
      }
    | {
        type: "delete-clip";
        clipId: FrontendId;
      }
    | {
        type: "retranscribe-clip";
        clipId: FrontendId;
      }
    | {
        /** Re-transcribe a whole Video's worth of Clips in one pass (#1571). */
        type: "retranscribe-clips";
        clipIds: FrontendId[];
      }
    | {
        type: "pause-toggle-key-pressed";
      }
    | {
        type: "press-alt-arrow-up";
      }
    | {
        type: "press-alt-arrow-down";
      }
    | {
        /**
         * A dot was clicked on the teleprompter glass. Plays its Clip, or
         * pauses it if it is the one already playing.
         */
        type: "click-teleprompter-mark";
        clipId: FrontendId;
      }
    | {
        /** The timeline's Clips changed, e.g. a Stream Deck delete. */
        type: "timeline-clips-changed";
        clipIds: FrontendId[];
      }
    | {
        type: "play-from-chapter";
        chapterId: FrontendId;
      }
    | {
        type: "scrub-to-time";
        time: number;
      }
    | {
        /** A copied link named this item, and the timeline has it. */
        type: "deep-link-target-found";
        itemId: FrontendId;
      }
    | {
        type: "create-video-from-selection-confirmed";
        title: string;
        mode: "copy" | "move";
      };
}

const preloadSelectedClips = (
  clipIds: FrontendId[],
  state: videoStateReducer.State
): videoStateReducer.State => {
  if (!state.currentClipId || !clipIds.includes(state.currentClipId)) {
    return state;
  }
  return {
    ...state,
    clipIdsPreloaded: preloadedAround(
      clipIds,
      state.currentClipId,
      state.selectedClipsSet
    ),
  };
};

type State = videoStateReducer.State;
type Action = videoStateReducer.Action;
type Exec = Parameters<
  EffectReducer<State, Action, videoStateReducer.Effect>
>[2];
type ActionOf<T extends Action["type"]> = Extract<Action, { type: T }>;

/** The timeline the reducer was made for. */
interface Timeline {
  /** All timeline item IDs (clips + chapters), in order. */
  itemIds: FrontendId[];
  /** Only the clip IDs, in order. */
  clipIds: FrontendId[];
}

const flipRunningState = (runningState: RunningState): RunningState =>
  runningState === "playing" ? "paused" : "playing";

/** The item selected most recently, if any. */
const lastSelected = (state: State): FrontendId | undefined =>
  Array.from(state.selectedClipsSet).pop();

/** The first clip after `index` in the timeline, if any. */
const firstClipAfter = (
  { itemIds, clipIds }: Timeline,
  index: number
): FrontendId | undefined => {
  const clipIdsSet = new Set(clipIds);
  for (let i = index + 1; i < itemIds.length; i++) {
    if (clipIdsSet.has(itemIds[i]!)) {
      return itemIds[i];
    }
  }
  return undefined;
};

/** Start playing `clipId` from its start, selecting only it. */
const playClip = (
  { clipIds }: Timeline,
  state: State,
  clipId: FrontendId
): State =>
  preloadSelectedClips(clipIds, {
    ...state,
    currentClipId: clipId,
    runningState: "playing",
    currentTimeInClip: 0,
    selectedClipsSet: new Set([clipId]),
  });

/** Toggle play/pause; playing clears the scrub and the last frame. */
const togglePlayback = (state: State): State => {
  const runningState = flipRunningState(state.runningState);
  return {
    ...state,
    runningState,
    scrubSeekTime: runningState === "playing" ? undefined : state.scrubSeekTime,
    showLastFrameOfVideo:
      runningState === "playing" ? false : state.showLastFrameOfVideo,
  };
};

/** `press-l` plays at 2x, `press-k` at 1x; at that rate already, toggles. */
const pressRateKey = (state: State, playbackRate: number): State => {
  if (state.playbackRate === playbackRate) {
    return {
      ...state,
      playbackRate,
      runningState: flipRunningState(state.runningState),
    };
  }
  return { ...state, playbackRate, runningState: "playing" };
};

const pressReturnOnChapter = (
  timeline: Timeline,
  state: State,
  chapterId: FrontendId
): State => {
  // If it's a chapter, find the first clip after it and play from there
  const chapterIndex = timeline.itemIds.findIndex((id) => id === chapterId);
  if (chapterIndex === -1) {
    return state;
  }
  const firstClipAfterSection = firstClipAfter(timeline, chapterIndex);
  if (!firstClipAfterSection) {
    // No clip after this section
    return state;
  }
  return playClip(timeline, state, firstClipAfterSection);
};

const pressReturn = (timeline: Timeline, state: State): State => {
  const newRunningState = flipRunningState(state.runningState);
  const newShowLastFrameOfVideo =
    newRunningState === "playing" ? false : state.showLastFrameOfVideo;
  if (state.selectedClipsSet.size === 0) {
    return {
      ...state,
      runningState: newRunningState,
      showLastFrameOfVideo: newShowLastFrameOfVideo,
    };
  }
  const mostRecentItemId = lastSelected(state)!;

  // Check if the selected item is a chapter (not in clipIds)
  if (!timeline.clipIds.includes(mostRecentItemId)) {
    return pressReturnOnChapter(timeline, state, mostRecentItemId);
  }

  if (state.currentClipId === mostRecentItemId) {
    return {
      ...state,
      selectedClipsSet: new Set([state.currentClipId]),
      runningState: newRunningState,
      showLastFrameOfVideo: newShowLastFrameOfVideo,
    };
  }

  return playClip(timeline, state, mostRecentItemId);
};

const clickTeleprompterMark = (
  timeline: Timeline,
  state: State,
  action: ActionOf<"click-teleprompter-mark">
): State => {
  // A mark can outlive its Clip on the glass by a push; a Clip that is
  // no longer on the timeline has nothing to play.
  if (!timeline.clipIds.includes(action.clipId)) return state;

  if (state.currentClipId === action.clipId) {
    return togglePlayback(state);
  }

  return preloadSelectedClips(timeline.clipIds, {
    ...state,
    currentClipId: action.clipId,
    runningState: "playing",
    currentTimeInClip: 0,
    scrubSeekTime: undefined,
    showLastFrameOfVideo: false,
    selectedClipsSet: new Set([action.clipId]),
  });
};

const playFromChapter = (
  timeline: Timeline,
  state: State,
  action: ActionOf<"play-from-chapter">
): State => {
  // Find the chapter's position in itemIds
  const chapterIndex = timeline.itemIds.findIndex(
    (id) => id === action.chapterId
  );
  if (chapterIndex === -1) {
    return state;
  }

  const firstClipAfterSection = firstClipAfter(timeline, chapterIndex);
  if (!firstClipAfterSection) {
    // No clip after this section, just select the chapter
    return {
      ...state,
      selectedClipsSet: new Set([action.chapterId]),
    };
  }

  // Play from the first clip after the section
  return playClip(timeline, state, firstClipAfterSection);
};

/** Ctrl-click toggles the clip in the selection. */
const ctrlClickClip = (
  { clipIds }: Timeline,
  state: State,
  clipId: FrontendId
): State => {
  const newSelectedClipsSet = new Set(state.selectedClipsSet);
  if (newSelectedClipsSet.has(clipId)) {
    newSelectedClipsSet.delete(clipId);
  } else {
    newSelectedClipsSet.add(clipId);
  }
  return preloadSelectedClips(clipIds, {
    ...state,
    selectedClipsSet: newSelectedClipsSet,
  });
};

/** Shift-click selects the range from the last selected item. */
const shiftClickClip = (
  { itemIds, clipIds }: Timeline,
  state: State,
  clipId: FrontendId
): State => {
  const mostRecentItemId = lastSelected(state);
  if (!mostRecentItemId) {
    return preloadSelectedClips(clipIds, {
      ...state,
      selectedClipsSet: new Set([clipId]),
    });
  }

  const mostRecentItemIndex = itemIds.findIndex(
    (itemId) => itemId === mostRecentItemId
  );
  if (mostRecentItemIndex === -1) {
    return state;
  }

  const newItemIndex = itemIds.findIndex((itemId) => itemId === clipId);
  if (newItemIndex === -1) {
    return state;
  }
  const firstIndex = Math.min(mostRecentItemIndex, newItemIndex);
  const lastIndex = Math.max(mostRecentItemIndex, newItemIndex);

  return preloadSelectedClips(clipIds, {
    ...state,
    selectedClipsSet: new Set(itemIds.slice(firstIndex, lastIndex + 1)),
  });
};

/** A plain click selects the clip, or plays it if it is the only one selected. */
const plainClickClip = (
  { clipIds }: Timeline,
  state: State,
  clipId: FrontendId
): State => {
  if (state.selectedClipsSet.size > 1) {
    return preloadSelectedClips(clipIds, {
      ...state,
      selectedClipsSet: new Set([clipId]),
    });
  }

  if (state.selectedClipsSet.has(clipId)) {
    return preloadSelectedClips(clipIds, {
      ...state,
      currentClipId: clipId,
      runningState: "playing",
      currentTimeInClip: 0,
    });
  }
  return preloadSelectedClips(clipIds, {
    ...state,
    selectedClipsSet: new Set([clipId]),
  });
};

const clickClip = (
  timeline: Timeline,
  state: State,
  action: ActionOf<"click-clip">
): State => {
  // Clear scrub state on any clip interaction
  const s = { ...state, scrubSeekTime: undefined };
  if (action.ctrlKey) return ctrlClickClip(timeline, s, action.clipId);
  if (action.shiftKey) return shiftClickClip(timeline, s, action.clipId);
  return plainClickClip(timeline, s, action.clipId);
};

/** The clip to select once the selected items are deleted. */
const clipToSelectAfterDelete = (
  clipIds: FrontendId[],
  state: State
): FrontendId | undefined => {
  // Find clips that are being deleted (for selection management)
  const lastClipBeingDeletedIndex = clipIds.findLastIndex((clipId) =>
    state.selectedClipsSet.has(clipId)
  );
  if (lastClipBeingDeletedIndex === -1) {
    // Only chapters were selected, keep first clip selected
    return clipIds[0];
  }
  return (
    clipIds[lastClipBeingDeletedIndex + 1] ??
    clipIds[lastClipBeingDeletedIndex - 1] ??
    clipIds[0]
  );
};

const pressDelete = (
  { clipIds }: Timeline,
  state: State,
  exec: Exec
): State => {
  // Handle deletion of both clips and chapters
  if (state.selectedClipsSet.size === 0) {
    return state;
  }

  // Determine next clip to select (only from clips, not chapters)
  const newSelectedClipId = clipToSelectAfterDelete(clipIds, state);

  const isCurrentClipDeleted =
    state.currentClipId && state.selectedClipsSet.has(state.currentClipId);

  exec({
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
};

const clipFinished = ({ clipIds }: Timeline, state: State): State => {
  const currentClipIndex = clipIds.findIndex(
    (clipId) => clipId === state.currentClipId
  );
  if (currentClipIndex === -1) {
    return state;
  }

  const nextClip = clipIds[currentClipIndex + 1];
  if (!nextClip) {
    return { ...state, runningState: "paused", scrubSeekTime: undefined };
  }
  return {
    ...state,
    currentClipId: nextClip,
    clipIdsPreloaded: preloadedAround(
      clipIds,
      nextClip,
      state.selectedClipsSet
    ),
    scrubSeekTime: undefined,
  };
};

/** Arrow keys move the selection one item back (-1) or forward (+1). */
const pressArrow = (
  { itemIds, clipIds }: Timeline,
  state: State,
  step: -1 | 1
): State => {
  if (state.selectedClipsSet.size === 0 && state.currentClipId) {
    return preloadSelectedClips(clipIds, {
      ...state,
      selectedClipsSet: new Set([state.currentClipId]),
    });
  }

  const mostRecentItemId = lastSelected(state)!;
  const currentItemIndex = itemIds.findIndex(
    (itemId) => itemId === mostRecentItemId
  );
  const targetItem = itemIds[currentItemIndex + step];
  if (!targetItem) {
    return state;
  }
  return preloadSelectedClips(clipIds, {
    ...state,
    selectedClipsSet: new Set([targetItem]),
  });
};

const deleteClip = (
  { clipIds }: Timeline,
  state: State,
  action: ActionOf<"delete-clip">,
  exec: Exec
): State => {
  exec({
    type: "archive-clips",
    clipIds: [action.clipId],
  });

  const deletedClipIndex = clipIds.findIndex((id) => id === action.clipId);
  const nextClip =
    clipIds[deletedClipIndex + 1] ??
    clipIds[deletedClipIndex - 1] ??
    clipIds[0];

  return preloadSelectedClips(clipIds, {
    ...state,
    selectedClipsSet: new Set([nextClip].filter((id) => id !== undefined)),
    runningState:
      state.currentClipId === action.clipId ? "paused" : state.runningState,
  });
};

const createVideoFromSelectionConfirmed = (
  { clipIds }: Timeline,
  state: State,
  action: ActionOf<"create-video-from-selection-confirmed">,
  exec: Exec
): State => {
  // Separate clips from chapters based on what's in clipIds array
  const clipIdsSet = new Set(clipIds);
  const selectedClipIds: FrontendId[] = [];
  const selectedChapterIds: FrontendId[] = [];

  for (const id of state.selectedClipsSet) {
    if (clipIdsSet.has(id)) {
      selectedClipIds.push(id);
    } else {
      selectedChapterIds.push(id);
    }
  }

  exec({
    type: "create-video-from-selection",
    clipIds: selectedClipIds,
    chapterIds: selectedChapterIds,
    title: action.title,
    mode: action.mode,
  });

  // In move mode, clear selection (items are being moved away)
  // In copy mode, keep selection unchanged (items remain in place)
  if (action.mode === "move") {
    return {
      ...state,
      selectedClipsSet: new Set<FrontendId>(),
    };
  }

  return state;
};

/** Declare `effect` for the most recently selected clip, if any. */
const execForLastSelected = (
  state: State,
  exec: Exec,
  effect: (clipId: FrontendId) => videoStateReducer.Effect
): State => {
  const selectedClipId = lastSelected(state);
  if (selectedClipId) {
    exec(effect(selectedClipId));
  }
  return state;
};

/**
 * Creates the video editor reducer.
 *
 * @param itemIds - All timeline item IDs (clips + chapters) for navigation (arrow keys, Home/End)
 * @param clipIds - Only clip IDs (subset of itemIds) for video playback operations
 *                  (preloading, clip-finished) since chapters have no video
 */
export const makeVideoEditorReducer =
  (
    itemIds: FrontendId[],
    clipIds: FrontendId[]
  ): EffectReducer<
    videoStateReducer.State,
    videoStateReducer.Action,
    videoStateReducer.Effect
  > =>
  (state, action, exec) => {
    if (isKeyOwnedByAnimatic(state, action)) return state;
    if (isDroppedWithoutReplay(state, action)) return state;
    const timeline: Timeline = { itemIds, clipIds };
    switch (action.type) {
      case "click-animatic-clip-mockup":
      case "dismiss-animatic":
        return reduceAnimatic(state, action, exec);
      case "toggle-last-frame-of-video":
        return {
          ...state,
          showLastFrameOfVideo: !state.showLastFrameOfVideo,
          runningState: "paused",
        };
      case "scrub-to-time":
        return {
          ...state,
          runningState: "paused",
          scrubSeekTime: action.time,
        };
      case "press-space-bar":
        return togglePlayback(state);
      case "press-home": {
        const firstItem = itemIds[0];
        if (!firstItem) return state;
        return { ...state, selectedClipsSet: new Set([firstItem]) };
      }
      case "press-end": {
        const lastItem = itemIds[itemIds.length - 1];
        if (!lastItem) return state;
        return { ...state, selectedClipsSet: new Set([lastItem]) };
      }
      case "press-l":
        return pressRateKey(state, 2);
      case "press-k":
        return pressRateKey(state, 1);
      case "press-pause":
        return { ...state, runningState: "paused" };
      case "press-play":
        return { ...state, runningState: "playing" };
      case "press-return":
        return pressReturn(timeline, state);
      case "click-teleprompter-mark":
        return clickTeleprompterMark(timeline, state, action);
      case "timeline-clips-changed": {
        // A deleted Clip can't stay playing: the glass would hide its red dot.
        const gone = state.currentClipId;
        if (!gone || action.clipIds.includes(gone)) return state;
        return { ...state, runningState: "paused", currentClipId: undefined };
      }
      case "play-from-chapter":
        return playFromChapter(timeline, state, action);
      case "deep-link-target-found":
        return { ...state, selectedClipsSet: new Set([action.itemId]) };
      case "click-clip":
        return clickClip(timeline, state, action);
      case "press-delete":
        return pressDelete(timeline, state, exec);
      case "update-clip-current-time":
        return { ...state, currentTimeInClip: action.time };
      case "clip-finished":
        return clipFinished(timeline, state);
      case "press-arrow-up":
      case "press-arrow-left":
        return pressArrow(timeline, state, -1);
      case "press-arrow-down":
      case "press-arrow-right":
        return pressArrow(timeline, state, 1);
      case "delete-clip":
        return deleteClip(timeline, state, action, exec);
      case "retranscribe-clips":
        // The Video-wide re-transcribe (#1571). The caller names the Clips
        // because only it can tell which of them are on the database — this
        // reducer holds ids, not Clips.
        if (action.clipIds.length > 0) {
          exec({ type: "retranscribe-clips", clipIds: action.clipIds });
        }
        return state;
      case "retranscribe-clip":
        exec({ type: "retranscribe-clips", clipIds: [action.clipId] });
        return state;
      case "pause-toggle-key-pressed":
        return execForLastSelected(state, exec, (clipId) => ({
          type: "toggle-pause-for-clip",
          clipId,
        }));
      case "press-alt-arrow-up":
        return execForLastSelected(state, exec, (clipId) => ({
          type: "move-clip",
          clipId,
          direction: "up",
        }));
      case "press-alt-arrow-down":
        return execForLastSelected(state, exec, (clipId) => ({
          type: "move-clip",
          clipId,
          direction: "down",
        }));
      case "create-video-from-selection-confirmed":
        return createVideoFromSelectionConfirmed(timeline, state, action, exec);
    }
    action satisfies never;
  };
