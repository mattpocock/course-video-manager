import type { DiagramPlaygroundEffect } from "./diagram-playground-reducer.types";
import type { diagramPlaygroundReducer } from "./diagram-playground-reducer";

type State = diagramPlaygroundReducer.State;
type Action = Extract<
  diagramPlaygroundReducer.Action,
  { type: "recording-status-reported" | "recentre-requested" }
>;

/**
 * `diagramPlaygroundReducer`'s say over where the camera centres outside a
 * scene load: as a take starts, and when the author asks. A take starting
 * also hides the sidebar and puts the window full screen. Both centre for
 * the playground's Video's format, which the video editor reports on every
 * heartbeat, recording or not.
 */
export function reduceCentring(
  state: State,
  action: Action,
  exec: (effect: DiagramPlaygroundEffect) => void
): State {
  if (action.type === "recentre-requested") {
    exec({ type: "centre-camera-after-layout", format: state.format });
    return state;
  }
  const reported =
    action.format === state.format
      ? state
      : { ...state, format: action.format };
  if (action.recording === state.recording) return reported;
  // The window is the recording surface: the sidebar hides while a take
  // records, though the author can still toggle it by hand.
  exec({ type: "set-focus-mode", isFocusMode: action.recording });
  // Centre once as a take starts; the author may pan during it.
  if (action.recording) {
    exec({ type: "centre-camera-after-layout", format: action.format });
    // The window is the recording surface, so it fills the screen — unless
    // it already does, when asking again would flash the browser's notice.
    if (!action.fullScreen) exec({ type: "enter-full-screen" });
  }
  return { ...reported, recording: action.recording };
}
