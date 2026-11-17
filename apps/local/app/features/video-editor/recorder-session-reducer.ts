import type { SilenceLength } from "@/silence-detection-constants";
import {
  createInitialSpeechDetectorState,
  speechDetectorReducer,
} from "./speech-detector-reducer";

/**
 * The Recording Session as the editor follows it (ADR 0050, ADR 0051): its
 * types and selectors. The rules below are the `idle`, `recording` and
 * `stopping` states of the CVM recorder's machine (`cvm-recorder-machine.ts`),
 * which also keeps the device (camera, scenes, screen, frames lost).
 *
 * - **Following.** The editor follows one Recording Session at a time: the
 *   one it heard start, or the one the Recorder names as recording. One the
 *   Recorder has said is over is never followed again (#2163).
 * - **The gate.** The recorder service refuses a Record the AV Calibration
 *   gate does not let through before it starts (ADR 0038), so the editor
 *   never hears it start.
 * - **Speech** runs through `speechDetectorReducer`, for the followed
 *   Recording Session only. A new Take shows as an Optimistic Clip
 *   (`start-take`); silence, or the Recording Session's end mid-speech,
 *   closes its audio window (`close-take-window`).
 * - **Attaching.** The first report a page hears that names a recording
 *   asks the Recorder to stop it: a page refreshed or closed mid-take left
 *   it going. A later report (a reconnect) of the Recording Session followed
 *   re-attaches to it and stops nothing (#2198). A streamed Recording
 *   Session (Go Live's) is never stopped this way: a page that first hears
 *   it re-attaches to it, as the Streaming tab does on return (ADR 0055).
 * - **Leaving.** As the page goes away (New Short, any other page, a
 *   reload, closing the tab) it hands the Recording Session it follows,
 *   recording or stopping (`followedOnLeave`), back to the Recorder: it is
 *   stopped as Stop stops it, and its last Take is placed at the editor's
 *   Insertion Point as it went (`use-cvm-recorder.ts`). Not a streamed
 *   one: only End Stream ends it, so leaving hands nothing back.
 * - **Unexpected events** are ignored, never thrown. A late event of a
 *   Recording Session not followed is expected (a replay after a failed
 *   save, #2163) and ignored quietly; a device event that cannot happen in
 *   its state is logged (`log-unexpected`).
 *
 * The clip effects are the clip reducer's events (ADR 0044): `start-session`
 * is its `recording-started`, `stop-session` its `recording-stopped`,
 * `start-take` its `new-optimistic-clip-detected`, `close-take-window` its
 * `clip-audio-window-closed`.
 */
export namespace recorderSessionReducer {
  export type Phase = "idle" | "recording" | "stopping";

  export type State = {
    phase: Phase;
    /** What the Recorder's silence detection hears of the followed Recording Session. */
    speech: speechDetectorReducer.State;
    /** The Recording Session the editor follows; null while none records. */
    recordingSessionId: string | null;
    /** Recording Sessions the Recorder has said are over, oldest first. */
    endedRecordingSessionIds: readonly string[];
    /** The Recorder has reported in to this page (Attaching). */
    attached: boolean;
    /**
     * The Recording Session followed is streamed (Go Live's), as the
     * Recorder last reported: leaving the page and Attaching never stop it.
     */
    streamed: boolean;
  };

  export type Event =
    | {
        /**
         * The Recorder says what it records now (the CVM recorder's
         * status): `recordingSessionId` is null while it records nothing.
         */
        type: "recorder-reported";
        reachable: boolean;
        recordingSessionId: string | null;
        /** It is a streamed Recording Session, which only End Stream ends. */
        streamed: boolean;
        silenceLength: SilenceLength;
      }
    | {
        type: "recording-started";
        recordingSessionId: string;
        silenceLength: SilenceLength;
      }
    | { type: "recording-stopped"; recordingSessionId: string }
    | {
        /** Silence detection heard this of a Recording Session; null: of none. */
        type: "speech-heard";
        recordingSessionId: string | null;
        heard: speechDetectorReducer.Action;
      }
    | { type: "press-stop" }
    | { type: "stop-recording-failed" };

  export type Effect =
    | { type: "stop-recording" }
    | {
        type: "start-session";
        recordingSessionId: string;
        silenceLength: SilenceLength;
      }
    | { type: "stop-session" }
    | { type: "start-take"; soundDetectionId: string }
    | { type: "close-take-window" }
    | { type: "log-unexpected"; message: string };
}

export namespace recorderSessionReducer {
  /** What the machine keeps; its state value is the Phase. */
  export type Context = Omit<State, "phase">;
}

export const createInitialRecorderSessionState =
  (): recorderSessionReducer.Context => ({
    speech: createInitialSpeechDetectorState(),
    recordingSessionId: null,
    endedRecordingSessionIds: [],
    attached: false,
    streamed: false,
  });

/** Whether Stop may be pressed. */
export const canPressStop = (state: recorderSessionReducer.State) =>
  state.phase === "recording";

/**
 * The Recording Session a page going away hands back to the Recorder: the
 * one it follows, still recording or stopping; null when idle, and for a
 * streamed one, which leaving never stops (ADR 0055).
 */
export const followedOnLeave = (
  state: recorderSessionReducer.State
): string | null =>
  state.phase === "idle" || state.streamed ? null : state.recordingSessionId;

/** Enough to recognise any late replay; a page records far fewer. */
const ENDED_KEPT = 50;

export const ended = (
  state: recorderSessionReducer.Context,
  id: string | null
): readonly string[] =>
  id === null || state.endedRecordingSessionIds.includes(id)
    ? state.endedRecordingSessionIds
    : [...state.endedRecordingSessionIds, id].slice(-ENDED_KEPT);

/**
 * Whether a Recording Session's event is the editor's to follow: the current
 * one's always; a start while none is followed, unless it is over; the stop
 * of the one just over, while nothing else records, for what it reports.
 * Anything else is a late replay. None is followed exactly while idle (the
 * machine's state contract), so this needs no Phase.
 */
export const follows = (
  state: recorderSessionReducer.Context,
  kind: "recording-started" | "recording-stopped" | "other",
  recordingSessionId: string
): boolean => {
  if (recordingSessionId === state.recordingSessionId) return true;
  switch (kind) {
    case "recording-started":
      return (
        !state.endedRecordingSessionIds.includes(recordingSessionId) &&
        state.recordingSessionId === null
      );
    case "recording-stopped":
      return (
        state.recordingSessionId === null &&
        state.endedRecordingSessionIds.at(-1) === recordingSessionId
      );
    case "other":
      return false;
  }
};
