import { MINIMUM_CLIP_LENGTH_SECONDS } from "@/silence-detection-constants";

/**
 * The speech state machine of both Recorders: what their silence detection
 * means for the take. Speech is what lies between one silence's end and the
 * next silence's start, as `parseSpeechFromFFmpeg` and the CVM recorder's
 * `speech-detector.ts` read silencedetect.
 *
 * - Before the first silence it is warming up.
 * - Speech becomes a Take (long enough for a Clip) in one of two ways, by
 *   whose clock decides:
 *   - OBS: the browser's silence scan (`silence-scan.ts`) carries the audio's
 *     own seconds. Speech that has gone on for the minimum Clip length since
 *     the last silence ended is a Take (`audio-heard`), with the id the
 *     scan stamped on that event.
 *   - The CVM recorder: its wire carries no audio time, and the recorder
 *     service alone decides what is a Take, by the rule its Clip is cut with
 *     (#2209). Its `take-started` makes the speech a Take with the service's
 *     take id. The editor never times this speech itself.
 *
 * Each Recorder's adapter turns its signals into these facts
 * (`speech-detector-scan.ts` for OBS, `cvm-recorder-reducer.ts` for the CVM
 * recorder).
 */
export namespace speechDetectorReducer {
  export type State =
    | { type: "warming-up" }
    | { type: "silence" }
    | {
        type: "speaking";
        /**
         * The audio time the speech started: null when the Recorder's
         * clock is not the detector's (the CVM recorder), so only
         * `take-started` makes it a Take.
         */
        silenceEndedAtSeconds: number | null;
        /** Set once the speech is long enough for a Clip. */
        soundDetectionId: string | null;
      };

  export type Action =
    | { type: "recording-started" }
    | { type: "silence-started" }
    /** Speech started; `endSeconds` is null with no audio clock. */
    | { type: "silence-ended"; endSeconds: number | null }
    /** More audio was heard with no silence change: the audio clock moved on. */
    | { type: "audio-heard"; atSeconds: number; soundDetectionId: string }
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
      return {
        type: "speaking",
        silenceEndedAtSeconds: action.endSeconds,
        soundDetectionId: null,
      };
    case "audio-heard":
      if (
        isAwaitingLongEnoughSpeech(state) &&
        action.atSeconds - state.silenceEndedAtSeconds >
          MINIMUM_CLIP_LENGTH_SECONDS
      ) {
        return { ...state, soundDetectionId: action.soundDetectionId };
      }
      return state;
    case "take-started":
      // Heard even mid-take on a page that joined late (warming up).
      return {
        type: "speaking",
        silenceEndedAtSeconds:
          state.type === "speaking" ? state.silenceEndedAtSeconds : null,
        soundDetectionId: action.soundDetectionId,
      };
  }
};

/** Whether the detector is waiting for speech to become long enough by its own clock: only then does the clock matter. */
export const isAwaitingLongEnoughSpeech = (
  state: speechDetectorReducer.State
): state is Extract<speechDetectorReducer.State, { type: "speaking" }> & {
  silenceEndedAtSeconds: number;
} =>
  state.type === "speaking" &&
  state.soundDetectionId === null &&
  state.silenceEndedAtSeconds !== null;

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
