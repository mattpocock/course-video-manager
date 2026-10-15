import type { EffectReducer } from "use-effect-reducer";
import {
  recordersForFormat,
  resolveVideoRecorder,
  type VideoRecorder,
} from "@cvm/core/features/videos/recorder";

/**
 * The editor's choice of which Recorder (OBS or CVM recorder) opens next on
 * one Video. It switches at any time except while capturing; the Video's
 * Clips keep the Recorders that filmed them (ADR 0036). The choice is saved
 * on the Video and, once saved, remembered as the last choice, which a new
 * Video then starts with (`last-recorder-choice.ts`). A Short has one option,
 * the CVM recorder (ADR 0037).
 */
export namespace recorderChoiceReducer {
  export type State = {
    /** The Recorders this Video may open (`recordersForFormat`). */
    options: readonly VideoRecorder[];
    /** The Recorder shown, and the one the editor records with. */
    recorder: VideoRecorder;
    /** The Recorder the Video last saved, to fall back to if a save fails. */
    saved: VideoRecorder;
    error: string | null;
  };

  export type Action =
    | {
        type: "recorder-picked";
        recorder: VideoRecorder;
        /** Whether a capture was in progress when the pick was made. */
        capturing: boolean;
      }
    | { type: "recorder-saved"; recorder: VideoRecorder }
    | {
        type: "recorder-save-failed";
        recorder: VideoRecorder;
        message: string;
      };

  export type Effect =
    | { type: "save-recorder"; recorder: VideoRecorder }
    | { type: "remember-recorder-choice"; recorder: VideoRecorder };
}

export const createInitialRecorderChoiceState = (video: {
  format: string;
  recorder: string | null;
}): recorderChoiceReducer.State => {
  const options = recordersForFormat(video.format);
  const recorder = resolveVideoRecorder(video);
  return { options, recorder, saved: recorder, error: null };
};

export const recorderChoiceReducer: EffectReducer<
  recorderChoiceReducer.State,
  recorderChoiceReducer.Action,
  recorderChoiceReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "recorder-picked": {
      if (
        action.capturing ||
        action.recorder === state.recorder ||
        !state.options.includes(action.recorder)
      ) {
        return state;
      }
      exec({ type: "save-recorder", recorder: action.recorder });
      return { ...state, recorder: action.recorder, error: null };
    }
    case "recorder-saved":
      // Remembered only once the Video took it: a refused choice must not
      // become the Recorder the next new Video starts with.
      exec({ type: "remember-recorder-choice", recorder: action.recorder });
      return { ...state, saved: action.recorder };
    case "recorder-save-failed":
      if (action.recorder !== state.recorder) return state;
      return { ...state, recorder: state.saved, error: action.message };
  }
};

/**
 * Whether OBS drives this Video: only then does the editor connect to OBS and
 * show its checks (profile, scene name, Virtual Camera preview).
 */
export const showsOBSChecks = (state: recorderChoiceReducer.State): boolean =>
  state.recorder === "obs";

/**
 * The CVM recorder's status and the composite preview: only while the CVM
 * recorder opens next.
 */
export const showsCvmRecorderControls = (
  state: Pick<recorderChoiceReducer.State, "recorder">
): boolean => state.recorder === "cvm";
