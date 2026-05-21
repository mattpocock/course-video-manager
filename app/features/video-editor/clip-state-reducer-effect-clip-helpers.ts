import type {
  ClipEffectOptimisticallyAdded,
  ClipOnDatabase,
  ClipOptimisticallyAdded,
  ClipReducerAction,
  ClipReducerExec,
  ClipReducerState,
  TimelineItem,
} from "./clip-state-reducer.types";
import { createFrontendId } from "./clip-state-reducer.types";

export const WHITE_NOISE_DEFAULTS = {
  text: "*white noise*",
  scene: "white noise",
  beatType: "none" as const,
  sourceStartTime: 0,
  sourceEndTime: 0.5,
};

export const handleAddEffectClipAt = (
  state: ClipReducerState,
  action: Extract<ClipReducerAction, { type: "add-effect-clip-at" }>,
  exec: ClipReducerExec
): ClipReducerState => {
  const targetItem = state.items.find(
    (item) => item.frontendId === action.itemId
  );
  if (!targetItem) {
    return state;
  }

  const targetIndex = state.items.findIndex(
    (item) => item.frontendId === action.itemId
  );

  // Inherit profile from the adjacent clip
  const adjacentClip = state.items.find(
    (
      item
    ): item is
      | ClipOnDatabase
      | ClipOptimisticallyAdded
      | ClipEffectOptimisticallyAdded =>
      item.type === "on-database" ||
      item.type === "optimistically-added" ||
      item.type === "effect-clip-optimistically-added"
  );
  const profile = adjacentClip?.profile ?? "main-camera";

  const newFrontendId = createFrontendId();
  const newEffectClip: ClipEffectOptimisticallyAdded = {
    type: "effect-clip-optimistically-added",
    frontendId: newFrontendId,
    videoFilename: "",
    sourceStartTime: WHITE_NOISE_DEFAULTS.sourceStartTime,
    sourceEndTime: WHITE_NOISE_DEFAULTS.sourceEndTime,
    text: WHITE_NOISE_DEFAULTS.text,
    scene: WHITE_NOISE_DEFAULTS.scene,
    profile,
    beatType: WHITE_NOISE_DEFAULTS.beatType,
    insertionOrder: state.insertionOrder + 1,
  };

  // Insert at the correct position
  let newItems: TimelineItem[];
  if (action.position === "before") {
    newItems = [
      ...state.items.slice(0, targetIndex),
      newEffectClip,
      ...state.items.slice(targetIndex),
    ];
  } else {
    newItems = [
      ...state.items.slice(0, targetIndex + 1),
      newEffectClip,
      ...state.items.slice(targetIndex + 1),
    ];
  }

  // Fire the appropriate effect based on whether the target has a database ID
  if (
    targetItem.type === "on-database" ||
    targetItem.type === "chapter-on-database"
  ) {
    const targetDatabaseId = targetItem.databaseId;
    const targetItemType: "clip" | "chapter" =
      targetItem.type === "on-database" ? "clip" : "chapter";
    exec({
      type: "create-effect-clip-at",
      frontendId: newFrontendId,
      position: action.position,
      targetItemId: targetDatabaseId,
      targetItemType,
      videoFilename: "",
      sourceStartTime: WHITE_NOISE_DEFAULTS.sourceStartTime,
      sourceEndTime: WHITE_NOISE_DEFAULTS.sourceEndTime,
      text: WHITE_NOISE_DEFAULTS.text,
      scene: WHITE_NOISE_DEFAULTS.scene,
      profile,
      beatType: WHITE_NOISE_DEFAULTS.beatType,
    });
  }

  return {
    ...state,
    items: newItems,
    insertionOrder: state.insertionOrder + 1,
  };
};
