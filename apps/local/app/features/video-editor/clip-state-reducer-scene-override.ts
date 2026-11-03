import { canZoomClip } from "@/features/videos/clip-zoom";
import { effectiveClipScene } from "@cvm/core/features/videos/effective-scene";
import type { EffectReducerExec } from "use-effect-reducer";
import type { clipStateReducer } from "./clip-state-reducer";

type SetSceneOverride = Extract<
  clipStateReducer.Action,
  { type: "set-scene-override" }
>;

/**
 * Set or clear a CVM-recorder Clip's Scene Override. The item changes at once,
 * so playback and stills (both derived from it) redraw before the save lands.
 * A zoom the new effective scene forbids is dropped, as the server drops it.
 * An OBS Clip, or one not saved yet, is left alone.
 */
export const handleSetSceneOverride = (
  state: clipStateReducer.State,
  action: SetSceneOverride,
  exec: EffectReducerExec<
    clipStateReducer.State,
    clipStateReducer.Action,
    clipStateReducer.Effect
  >
): clipStateReducer.State => {
  const item = state.items.find((i) => i.frontendId === action.clipId);
  if (!item || item.type !== "on-database" || !item.recordingSession) {
    return state;
  }

  const zoomType = canZoomClip(
    effectiveClipScene({
      scene: item.scene,
      sceneOverride: action.sceneOverride,
    }),
    item.layers ?? []
  )
    ? item.zoomType
    : "none";

  exec({
    type: "update-scene-override",
    clipId: item.databaseId,
    sceneOverride: action.sceneOverride,
  });

  return {
    ...state,
    items: state.items.map((i) =>
      i === item
        ? { ...item, sceneOverride: action.sceneOverride, zoomType }
        : i
    ),
  };
};
