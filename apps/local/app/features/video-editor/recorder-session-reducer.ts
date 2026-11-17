import {
  isUnhandled,
  transition,
  type EventObject,
  type SnapshotFrom,
} from "xstate";
import type { SilenceLength } from "@/silence-detection-constants";
import {
  createInitialSpeechDetectorState,
  type speechDetectorReducer,
} from "./speech-detector-reducer";
import { recorderSessionMachine } from "./recorder-session-machine";

/**
 * The Recording Session as the editor follows it (ADR 0050, ADR 0051). The
 * CVM recorder's adapter (`cvm-recorder-reducer.ts`) runs the recorder's
 * signals through this reducer, and keeps the device (camera, scenes,
 * screen, frames lost) to itself.
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

type Exec = (effect: recorderSessionReducer.Effect) => void;

export const createInitialRecorderSessionState =
  (): recorderSessionReducer.State => ({
    phase: "idle",
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

/**
 * Whether a Recording Session's event is the editor's to follow: the current
 * one's always; a start while none is followed, unless it is over; the stop
 * of the one just over, while nothing else records, for what it reports.
 * Anything else is a late replay.
 */
export const follows = (
  state: recorderSessionReducer.State,
  kind: "recording-started" | "recording-stopped" | "other",
  recordingSessionId: string
): boolean => {
  if (recordingSessionId === state.recordingSessionId) return true;
  switch (kind) {
    case "recording-started":
      return (
        !state.endedRecordingSessionIds.includes(recordingSessionId) &&
        state.phase === "idle"
      );
    case "recording-stopped":
      return (
        state.recordingSessionId === null &&
        state.phase === "idle" &&
        state.endedRecordingSessionIds.at(-1) === recordingSessionId
      );
    case "other":
      return false;
  }
};

/** Every effect the machine emits: the reducer hands on only these. */
const EFFECT_TYPES = {
  "stop-recording": true,
  "start-session": true,
  "stop-session": true,
  "start-take": true,
  "close-take-window": true,
  "log-unexpected": true,
} satisfies Record<recorderSessionReducer.Effect["type"], true>;

const isEffect = (event: EventObject): event is recorderSessionReducer.Effect =>
  Object.hasOwn(EFFECT_TYPES, event.type);

const toSnapshot = (state: recorderSessionReducer.State) =>
  recorderSessionMachine.resolveState({
    value: state.phase === "idle" ? "idle" : { following: state.phase },
    context: {
      speech: state.speech,
      recordingSessionId: state.recordingSessionId,
      endedRecordingSessionIds: state.endedRecordingSessionIds,
      attached: state.attached,
      streamed: state.streamed,
    },
  });

const phaseOf = (
  snapshot: SnapshotFrom<typeof recorderSessionMachine>
): recorderSessionReducer.Phase => {
  if (snapshot.matches("idle")) return "idle";
  return snapshot.matches({ following: "stopping" }) ? "stopping" : "recording";
};

/**
 * The one recording-session reducer, composed into each Recorder's own:
 * their state extends this one's, which it returns updated. It runs
 * `recorderSessionMachine` with the pure `transition()`; an event no state
 * handles leaves the state as it was.
 */
export const recorderSessionReducer = <S extends recorderSessionReducer.State>(
  state: S,
  event: recorderSessionReducer.Event,
  exec: Exec
): S => {
  const before = toSnapshot(state);
  const result = transition(recorderSessionMachine, before, event);
  if (isUnhandled(before, result)) return state;
  const [after, effects] = result;
  for (const effect of effects)
    if (effect.kind === "emit" && isEffect(effect.event)) exec(effect.event);
  const { speech, recordingSessionId, endedRecordingSessionIds } =
    after.context;
  return {
    ...state,
    phase: phaseOf(after),
    speech,
    recordingSessionId,
    endedRecordingSessionIds,
    attached: after.context.attached,
    streamed: after.context.streamed,
  };
};
