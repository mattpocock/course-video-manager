import type { PauseType } from "@/services/video-processing-service";
import type { clipStateReducer } from "./clip-state-reducer";
import type {
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  FrontendInsertionPoint,
} from "./clip-state-reducer.types";
import { canZoomClip, type ClipZoomType } from "@/features/videos/clip-zoom";
import { isTranscriptionPending } from "@/features/videos/transcription-status";
import { effectiveClipScene } from "@cvm/core/features/videos/effective-scene";

type State = clipStateReducer.State;
type Action = clipStateReducer.Action;
type Exec = Parameters<typeof clipStateReducer>[2];
type Item = State["items"][number];

type ActionOf<T extends Action["type"]> = Extract<Action, { type: T }>;

/** A recorded Clip, saved or optimistic: not an Effect Clip, not a Chapter. */
type Clip = ClipOnDatabase | ClipOptimisticallyAdded;

const isClip = (item: Item | undefined): item is Clip =>
  item?.type === "on-database" || item?.type === "optimistically-added";

/** The insertion point just after this item, whichever kind it is. */
const insertionPointAfter = (item: Item): FrontendInsertionPoint =>
  isClip(item)
    ? { type: "after-clip", frontendClipId: item.frontendId }
    : { type: "after-chapter", frontendChapterId: item.frontendId };

export const handleSetInsertionPointAfter = (
  state: State,
  action: ActionOf<"set-insertion-point-after">
): State => {
  const item = state.items.find((c) => c.frontendId === action.clipId);
  if (!item) {
    return state;
  }

  return { ...state, insertionPoint: insertionPointAfter(item) };
};

export const handleSetInsertionPointBefore = (
  state: State,
  action: ActionOf<"set-insertion-point-before">
): State => {
  // If inserting before, we need to find the previous item's frontendId
  // to use as insertAfterId, OR use INSERTION_POINT_START if this is first item
  const itemIndex = state.items.findIndex(
    (c) => c.frontendId === action.clipId
  );
  if (itemIndex === -1) {
    return state;
  }

  if (itemIndex === 0) {
    return { ...state, insertionPoint: { type: "start" } };
  }

  const previousItem = state.items[itemIndex - 1];
  if (!previousItem) {
    throw new Error("Previous item not found when inserting before");
  }

  return { ...state, insertionPoint: insertionPointAfter(previousItem) };
};

/** Flip a Clip's pause, writing it through when the Clip is saved. */
const togglePause = (state: State, clipToToggle: Clip, exec: Exec): State => {
  const newPauseType: PauseType =
    clipToToggle.pauseType === "none" ? "long" : "none";

  // If it's a database clip, fire an effect to update the DB
  if (clipToToggle.type === "on-database") {
    exec({
      type: "update-pause",
      clipId: clipToToggle.databaseId,
      pauseType: newPauseType,
    });
  }

  return {
    ...state,
    items: state.items.map((item) =>
      item.frontendId === clipToToggle.frontendId && isClip(item)
        ? { ...item, pauseType: newPauseType }
        : item
    ),
  };
};

/** The Clip the insertion point sits after, if it sits after a Clip. */
const clipAtInsertionPoint = (state: State): Clip | undefined => {
  const point = state.insertionPoint;
  if (point.type === "end") {
    const lastItem = state.items[state.items.length - 1];
    return isClip(lastItem) ? lastItem : undefined;
  }
  if (point.type === "after-clip") {
    const item = state.items.find((c) => c.frontendId === point.frontendClipId);
    return isClip(item) ? item : undefined;
  }
  // No clip before start, and don't toggle pause for chapters
  return undefined;
};

export const handleTogglePauseAtInsertionPoint = (
  state: State,
  exec: Exec
): State => {
  const clipToToggle = clipAtInsertionPoint(state);
  if (!clipToToggle) {
    return state;
  }
  return togglePause(state, clipToToggle, exec);
};

export const handleTogglePauseForClip = (
  state: State,
  action: ActionOf<"toggle-pause-for-clip">,
  exec: Exec
): State => {
  const item = state.items.find((c) => c.frontendId === action.clipId);
  if (!isClip(item)) {
    return state;
  }
  return togglePause(state, item, exec);
};

export const handleClipTextEdited = (
  state: State,
  action: ActionOf<"clip-text-edited">,
  exec: Exec
): State => {
  const item = state.items.find((c) => c.frontendId === action.clipId);
  const text = action.text.trim();
  // Only a saved Clip has text to edit, and not mid-Transcription: the
  // Transcription landing would overwrite the edit.
  if (
    item?.type !== "on-database" ||
    isTranscriptionPending(item.transcriptionStatus) ||
    item.text === text
  ) {
    return state;
  }
  exec({ type: "update-clip-text", clipId: item.databaseId, text });
  return {
    ...state,
    items: state.items.map((clip) =>
      clip === item ? { ...item, text } : clip
    ),
  };
};

export const handleToggleZoomForClip = (
  state: State,
  action: ActionOf<"toggle-zoom-for-clip">,
  exec: Exec
): State => {
  const item = state.items.find((c) => c.frontendId === action.clipId);

  // Only a persisted clip can be zoomed: the write needs a database id,
  // and the eligibility rule reads the clip's recorded scene.
  if (
    !item ||
    item.type !== "on-database" ||
    !canZoomClip(effectiveClipScene(item))
  ) {
    return state;
  }

  const newZoomType: ClipZoomType =
    item.zoomType === "none" ? "subtle" : "none";

  exec({
    type: "update-zoom",
    clipId: item.databaseId,
    zoomType: newZoomType,
  });

  return {
    ...state,
    items: state.items.map((c) =>
      c.frontendId === action.clipId && c.type === "on-database"
        ? { ...c, zoomType: newZoomType }
        : c
    ),
  };
};

/** Fire the reorder write for a saved Clip or Chapter. */
const execReorder = (
  item: Item,
  direction: ActionOf<"move-clip">["direction"],
  exec: Exec
) => {
  if (item.type === "on-database") {
    exec({ type: "reorder-clip", clipId: item.databaseId, direction });
  } else if (item.type === "chapter-on-database") {
    exec({ type: "reorder-chapter", chapterId: item.databaseId, direction });
  }
};

export const handleMoveClip = (
  state: State,
  action: ActionOf<"move-clip">,
  exec: Exec
): State => {
  const clipIndex = state.items.findIndex(
    (c) => c.frontendId === action.clipId
  );

  if (clipIndex === -1) {
    return state;
  }

  const item = state.items[clipIndex]!;
  const targetIndex = action.direction === "up" ? clipIndex - 1 : clipIndex + 1;

  // Check boundaries
  if (targetIndex < 0 || targetIndex >= state.items.length) {
    return state;
  }

  // Swap items in the array
  const newItems = [...state.items];
  newItems[clipIndex] = newItems[targetIndex]!;
  newItems[targetIndex] = item;

  execReorder(item, action.direction, exec);

  return { ...state, items: newItems };
};

export const handleEffectClipCreated = (
  state: State,
  action: ActionOf<"effect-clip-created">
): State => ({
  ...state,
  items: state.items.map((item) => {
    if (
      item.frontendId !== action.frontendId ||
      item.type !== "effect-clip-optimistically-added"
    ) {
      return item;
    }
    const onDatabase: ClipOnDatabase = {
      type: "on-database",
      frontendId: item.frontendId,
      databaseId: action.databaseId,
      videoFilename: item.videoFilename,
      sourceStartTime: item.sourceStartTime,
      sourceEndTime: item.sourceEndTime,
      text: item.text,
      transcribedAt: new Date(),
      transcriptionStatus: "done",
      scene: item.scene,
      profile: item.profile,
      insertionOrder: item.insertionOrder,
      pauseType: item.pauseType,
      // Effect Clips are white noise — never a camera scene, so never
      // zoomable. The field exists; the value can only ever be "none".
      zoomType: "none",
      diagramSnapshotId: null,
      diagramName: null,
      webLinks: [],
    };
    return onDatabase;
  }),
});
