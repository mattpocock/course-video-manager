import type { SilenceLength } from "@/silence-detection-constants";
import {
  createInitialSpeechDetectorState,
  speechDetectorReducer,
} from "./speech-detector-reducer";

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
 *   re-attaches to it and stops nothing (#2198).
 * - **Leaving.** The page asks the Recorder to stop as it goes away, while
 *   `stopsOnLeave` (`use-cvm-recorder.ts`).
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
  });

/** Whether Stop may be pressed, and whether leaving the page stops the take. */
export const stopsOnLeave = (state: recorderSessionReducer.State) =>
  state.phase === "recording";

/** Enough to recognise any late replay; a page records far fewer. */
const ENDED_KEPT = 50;

const ended = (
  state: recorderSessionReducer.State,
  id: string | null
): readonly string[] =>
  id === null || state.endedRecordingSessionIds.includes(id)
    ? state.endedRecordingSessionIds
    : [...state.endedRecordingSessionIds, id].slice(-ENDED_KEPT);

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

/** The clip reducer's half of a change of the Recording Session followed. */
const followChanged = (
  before: recorderSessionReducer.State,
  after: recorderSessionReducer.State,
  exec: Exec,
  start?: { silenceLength: SilenceLength }
) => {
  if (before.recordingSessionId === after.recordingSessionId) return;
  if (before.recordingSessionId !== null) {
    // Stop lets a take go at the press (#2211): the audio window of speech
    // going on closes now, as the silence after it would have closed it.
    if (before.speech.type === "speaking") exec({ type: "close-take-window" });
    exec({ type: "stop-session" });
  }
  if (after.recordingSessionId !== null && start)
    exec({
      type: "start-session",
      recordingSessionId: after.recordingSessionId,
      silenceLength: start.silenceLength,
    });
};

const soundOf = (speech: speechDetectorReducer.State) =>
  speech.type === "speaking" ? speech.soundDetectionId : null;

/** What a change of speech means for a Take. */
const takeEffects = (
  before: speechDetectorReducer.State,
  after: speechDetectorReducer.State,
  exec: Exec
) => {
  const sound = soundOf(after);
  if (sound !== null && sound !== soundOf(before))
    exec({ type: "start-take", soundDetectionId: sound });
  else if (before.type !== "silence" && after.type === "silence")
    exec({ type: "close-take-window" });
};

const over = <S extends recorderSessionReducer.State>(
  state: S,
  id: string
): S => ({
  ...state,
  phase: "idle",
  speech: createInitialSpeechDetectorState(),
  recordingSessionId: null,
  endedRecordingSessionIds: ended(state, id),
});

/**
 * The one recording-session reducer, composed into each Recorder's own:
 * their state extends this one's, which it returns updated.
 */
export const recorderSessionReducer = <S extends recorderSessionReducer.State>(
  state: S,
  event: recorderSessionReducer.Event,
  exec: Exec
): S => {
  switch (event.type) {
    case "recorder-reported": {
      const current = state.recordingSessionId;
      let next: S = state;
      if (event.recordingSessionId === null) {
        if (current !== null) next = over(state, current);
      } else if (event.recordingSessionId !== current) {
        if (state.endedRecordingSessionIds.includes(event.recordingSessionId))
          return state;
        // The Recorder's word on what records now is the truth.
        next = {
          ...state,
          recordingSessionId: event.recordingSessionId,
          endedRecordingSessionIds: ended(state, current),
          phase: state.phase === "stopping" ? "stopping" : "recording",
          // Joined mid-take, nothing is known until the Recorder next hears.
          speech:
            state.phase === "idle"
              ? createInitialSpeechDetectorState()
              : state.speech,
        };
      }
      followChanged(state, next, exec, event);
      if (next.attached || !event.reachable) return next;
      if (next.phase !== "recording") return { ...next, attached: true };
      exec({ type: "stop-recording" });
      return { ...next, attached: true, phase: "stopping" };
    }
    case "recording-started": {
      const id = event.recordingSessionId;
      if (!follows(state, "recording-started", id)) return state;
      const next: S = {
        ...state,
        phase: "recording",
        speech: speechDetectorReducer(state.speech, {
          type: "recording-started",
        }),
        recordingSessionId: id,
      };
      followChanged(state, next, exec, event);
      return next;
    }
    case "recording-stopped": {
      if (event.recordingSessionId !== state.recordingSessionId) return state;
      const next = over(state, event.recordingSessionId);
      followChanged(state, next, exec);
      return next;
    }
    case "speech-heard": {
      if (
        event.recordingSessionId === null ||
        event.recordingSessionId !== state.recordingSessionId
      )
        return state;
      const speech = speechDetectorReducer(state.speech, event.heard);
      if (speech === state.speech) return state;
      takeEffects(state.speech, speech, exec);
      return { ...state, speech };
    }
    case "press-stop":
      if (!stopsOnLeave(state)) return state;
      exec({ type: "stop-recording" });
      return { ...state, phase: "stopping" };
    case "stop-recording-failed":
      return state.phase === "stopping"
        ? { ...state, phase: "recording" }
        : state;
  }
};
