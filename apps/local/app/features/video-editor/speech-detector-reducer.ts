/**
 * The speech state machine: what the recorder's silence detection means for
 * the take. Speech is what lies between one silence's end and the next
 * silence's start, as `parseSpeechFromFFmpeg` and the CVM recorder's
 * `speech-detector.ts` read silencedetect.
 *
 * - Before the first silence it is warming up.
 * - Speech becomes a Take (long enough for a Clip) only when the recorder
 *   service says so: its wire carries no audio time, and it alone decides
 *   what is a Take, by the rule its Clip is cut with (#2209). Its
 *   `take-started` makes the speech a Take with the service's take id. The
 *   editor never times speech itself.
 *
 * `cvm-recorder-reducer.ts` turns the recorder's messages into these facts.
 */
export namespace speechDetectorReducer {
  export type State =
    | { type: "warming-up" }
    | { type: "silence" }
    | {
        type: "speaking";
        /** Set once the speech is long enough for a Clip. */
        soundDetectionId: string | null;
      };

  export type Action =
    | { type: "recording-started" }
    | { type: "silence-started" }
    /** Speech started. */
    | { type: "silence-ended" }
    /** The Recorder decided the speech going on is a Take. */
    | { type: "take-started"; soundDetectionId: string };
}

export type FrontendSpeechDetectorState =
  | { type: "warming-up" }
  | { type: "speaking-detected" }
  | { type: "long-enough-speaking-for-clip-detected"; soundDetectionId: string }
  | { type: "silence" };

const WARMING_UP: speechDetectorReducer.State = { type: "warming-up" };

export const createInitialSpeechDetectorState =
  (): speechDetectorReducer.State => WARMING_UP;

export const speechDetectorReducer = (
  state: speechDetectorReducer.State,
  action: speechDetectorReducer.Action
): speechDetectorReducer.State => {
  switch (action.type) {
    case "recording-started":
      return createInitialSpeechDetectorState();
    case "silence-started":
      return state.type === "silence" ? state : { type: "silence" };
    case "silence-ended":
      return { type: "speaking", soundDetectionId: null };
    case "take-started":
      // Heard even mid-take on a page that joined late (warming up).
      return { type: "speaking", soundDetectionId: action.soundDetectionId };
  }
};

/**
 * What the editor and the teleprompter show of the speech. The same state
 * always gives the same object, so a render that changes no speech changes
 * nothing downstream.
 */
export const toFrontendSpeechDetectorState = (
  state: speechDetectorReducer.State
): FrontendSpeechDetectorState => {
  let shown = SHOWN.get(state);
  if (!shown) {
    shown = toFrontend(state);
    SHOWN.set(state, shown);
  }
  return shown;
};

const SHOWN = new WeakMap<
  speechDetectorReducer.State,
  FrontendSpeechDetectorState
>();

const toFrontend = (
  state: speechDetectorReducer.State
): FrontendSpeechDetectorState => {
  switch (state.type) {
    case "warming-up":
      return { type: "warming-up" };
    case "silence":
      return { type: "silence" };
    case "speaking":
      return state.soundDetectionId
        ? {
            type: "long-enough-speaking-for-clip-detected",
            soundDetectionId: state.soundDetectionId,
          }
        : { type: "speaking-detected" };
  }
};
