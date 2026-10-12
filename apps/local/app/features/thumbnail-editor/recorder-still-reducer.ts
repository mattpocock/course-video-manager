import type { EffectReducer, EffectReducerExec } from "use-effect-reducer";
import {
  canRetryCamera,
  createInitialNewRecorderState,
  newRecorderReducer,
} from "@/features/video-editor/new-recorder-reducer";
import type { NewRecorderMessage } from "@/features/video-editor/new-recorder-wire";

/**
 * The thumbnail camera on a New recorder Video (#2012): it takes its still
 * from the recorder service (`GET /still`, a 1280x720 JPEG) instead of the
 * OBS Virtual Camera. While the modal is open it listens to the Video's
 * recorder events like the editor does, which keeps the recorder (and the
 * Cam Link) open; the camera's state is the editor's own `newRecorderReducer`
 * view of those events.
 */
export namespace recorderStillReducer {
  export type State = {
    /** The recorder and its camera, as the editor sees them. */
    recorder: newRecorderReducer.State;
    /** Where the still is fetched from; null until the app server says. */
    stillUrl: string | null;
    taking: boolean;
    /** The still taken, as a 1280x720 PNG data URL, until Retake. */
    still: string | null;
    /** Why the last still could not be taken. */
    error: string | null;
  };

  export type Action =
    | { type: "recorder-message-heard"; message: NewRecorderMessage }
    | { type: "press-capture" }
    | { type: "still-taken"; dataUrl: string }
    | { type: "still-failed"; message: string }
    | { type: "press-retake" }
    | { type: "press-retry" }
    | { type: "retry-camera-failed"; message: string };

  export type Effect =
    { type: "take-still"; url: string } | { type: "retry-camera" };
}

export const createInitialRecorderStillState =
  (): recorderStillReducer.State => ({
    recorder: createInitialNewRecorderState(),
    stillUrl: null,
    taking: false,
    still: null,
    error: null,
  });

export const canCapture = (state: recorderStillReducer.State) =>
  state.stillUrl !== null &&
  !state.taking &&
  state.still === null &&
  state.recorder.reachable === true &&
  state.recorder.phase === "idle" &&
  state.recorder.camera.kind === "live";

/** Hearing a message or a failed Retry declares no effects in the editor's reducer. */
const noEffects = (() => {}) as unknown as EffectReducerExec<
  newRecorderReducer.State,
  newRecorderReducer.Action,
  newRecorderReducer.Effect
>;

export const recorderStillReducer: EffectReducer<
  recorderStillReducer.State,
  recorderStillReducer.Action,
  recorderStillReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "recorder-message-heard":
    case "retry-camera-failed":
      return {
        ...state,
        recorder: newRecorderReducer(state.recorder, action, noEffects),
        stillUrl:
          action.type === "recorder-message-heard" &&
          action.message.type === "recorder-status"
            ? action.message.still
            : state.stillUrl,
      };
    case "press-capture":
      if (!canCapture(state) || !state.stillUrl) return state;
      exec({ type: "take-still", url: state.stillUrl });
      return { ...state, taking: true, error: null };
    case "still-taken":
      return { ...state, taking: false, still: action.dataUrl };
    case "still-failed":
      return { ...state, taking: false, error: action.message };
    case "press-retake":
      return { ...state, still: null, error: null };
    case "press-retry":
      if (!canRetryCamera(state.recorder)) return state;
      exec({ type: "retry-camera" });
      return {
        ...state,
        recorder: { ...state.recorder, retrying: true, error: null },
      };
  }
};

/** What the modal shows in place of the camera, or null once it is live. */
export const cameraWaitText = (
  state: recorderStillReducer.State
): string | null => {
  const { recorder } = state;
  if (recorder.reachable === null) return "Connecting to the recorder…";
  if (!recorder.reachable) return "The recorder service is not running.";
  if (recorder.problem) return recorder.problem;
  if (recorder.phase !== "idle")
    return "The recorder is recording: stop it to take a still.";
  switch (recorder.camera.kind) {
    case "closed":
      return "Opening the recorder…";
    case "opening":
      return recorder.camera.attempt > 1
        ? `Opening the Cam Link (try ${recorder.camera.attempt})…`
        : "Opening the Cam Link…";
    case "not-starting":
    case "busy":
      return recorder.camera.message;
    case "live":
      return null;
  }
};
