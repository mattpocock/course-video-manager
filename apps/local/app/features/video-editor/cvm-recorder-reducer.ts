import type { EffectReducer } from "use-effect-reducer";
import type { Scene } from "@/packages/scene-layout";
import type { SilenceLength } from "@/silence-detection-constants";
import type { VideoFormat } from "@/features/videos/video-format";
import type {
  FramesLost,
  LostFrameSpan,
  ScreenStatus,
} from "recorder-service/protocol";
import { isSceneAvailable, isScreenWaking } from "./cvm-recorder-screen";
import { attach } from "./cvm-recorder-attach";
import { placeClips } from "./cvm-recorder-clips";
import {
  describeFramesLostInClips,
  trackFramesLost,
  type TakeSpan,
} from "./cvm-recorder-frames-lost";
import type {
  CvmRecorderMessage,
  SavedRecorderClip,
} from "./cvm-recorder-wire";
import type { FrontendSpeechDetectorState } from "./use-speech-detector";

/**
 * The CVM recorder's Record and Stop in the editor. The recorder service
 * records; this follows what the app server reports of it (`recorder-message-
 * heard`) and asks for Record and Stop. Whatever started a recording, the
 * editor shows what the recorder says.
 *
 * The Cam Link opens when the editor opens (the app server's recorder client
 * opens the recorder while an editor listens); Record waits for
 * `camera-went-live`, and the replug and Close-OBS messages wait for Retry.
 *
 * Scenes: the preview draws the scene the recorder says it is in
 * (`scene-changed`); a scene button asks the recorder to switch, and the
 * preview follows once it has.
 *
 * A Short's screen is the Spacedesk display, which the recorder wakes when it
 * opens (`screen-changed`): until it is ready, only scenes that do not draw
 * the screen (Camera) may be switched to or recorded in, and once it is
 * unavailable Matt may wake Spacedesk again (`cvm-recorder-screen.ts`).
 *
 * The Stream Deck records, stops and switches scenes on the recorder service
 * directly: the editor hears the same messages as for its own buttons, so it
 * follows them the same way. For a Stream Deck Record to use the editor's
 * Silence Length, the editor tells the app server its choice whenever it
 * changes and whenever the recorder reports in.
 *
 * Speech: the recorder's silence detection, in the OBS path's vocabulary
 * (`FrontendSpeechDetectorState`), so the editor and the teleprompter show a
 * take the same whichever Recorder films it. Record warms up until the
 * recorder hears the first silence (`warmed-up`); speech shows as speaking,
 * then as long enough for a Clip when the recorder says it is a Take
 * (`take-started`). The editor never times speech itself: the recorder
 * service alone decides what is a Take, by the rule its Clip is cut with, so
 * every Optimistic Clip gets a Clip. A silence as long as the Silence Length
 * (`speech-ended`) closes it.
 *
 * Attaching: a page stops a take it finds going, as OBS does on connect
 * (`cvm-recorder-attach.ts`).
 *
 * Sessions: the editor follows one Recording Session at a time, the one the
 * recorder says is recording (`recorder-status`) or that just started. A
 * Recording Session's events can arrive late (held behind a save that
 * failed, then replayed from its start), so an event of any other Recording
 * Session is ignored, and one the recorder has said is over never makes the
 * editor record again (#2163). The stop of the one just recorded still
 * reports its errors and frames lost when it lands after the status.
 *
 * Clips: this is an adapter onto the OBS path's clip logic, which does all
 * the placing (`clip-state-reducer-recording.ts`; ADR 0044). It sends the
 * clip reducer the events OBS's connector and polling send: a Recording
 * Session followed starts and stops one there (`start-session`,
 * `stop-session`), a Take is an Optimistic Clip (`start-take`), silence
 * closes its audio window (`close-take-window`), and at a Take's end the
 * editor tells the app server where to save it, as OBS's polling
 * does, and hears back the saved Clips (`place-take`). The app server's
 * status can say a Recording Session stopped before its last speech is
 * saved, so the editor places a Recording Session's speech from when it
 * follows it until that Recording Session's own stop, or the next one
 * starts (`placing`).
 */
export namespace cvmRecorderReducer {
  export type Phase = "idle" | "starting" | "recording" | "stopping";

  export type Camera =
    | { kind: "closed" }
    | { kind: "opening"; attempt: number }
    | { kind: "live" }
    | { kind: "not-starting"; message: string }
    | { kind: "busy"; message: string };

  export type State = {
    /** The Video's format: a Short is drawn, and recorded, 9:16. */
    format: VideoFormat;
    /** Null until the app server first says. */
    reachable: boolean | null;
    /** The recorder has reported in to this page (Attaching). */
    attached: boolean;
    /** Why the recorder cannot record at all (a wrong ffmpeg). */
    problem: string | null;
    phase: Phase;
    camera: Camera;
    /** Retry was pressed and the camera has not started opening again yet. */
    retrying: boolean;
    /** Where the browser watches the raw camera and screen. */
    previews: { camera: string; screen: string } | null;
    /** What the recorder's silence detection hears; read while recording. */
    speech: FrontendSpeechDetectorState;
    /** The scene the recorder draws; null while it is not open for this Video. */
    scene: Scene | null;
    /** A Short's screen; null while not open for this Video, and for Landscape. */
    screen: ScreenStatus | null;
    /** Wake Spacedesk again was pressed and the recorder is not waking it yet. */
    wakingAgain: boolean;
    /** The last thing that went wrong, until the next Record. */
    error: string | null;
    /**
     * Something Matt must see at once (the camera lost mid-recording, a
     * Recording Session cut off by a crash), until he dismisses it.
     */
    alert: string | null;
    /**
     * The Recording Session's frames lost, every one, in or out of a Clip:
     * live while it records (#2214), then the last one's, until the next
     * Record.
     */
    framesLost: FramesLost | null;
    /**
     * Where in the Recording Session placed frames were lost, and its
     * Takes' spans: the frames-lost alert is for a loss inside one
     * (`cvm-recorder-frames-lost.ts`, #2227).
     */
    lostFrameSpans: readonly LostFrameSpan[];
    takeSpans: readonly TakeSpan[];
    /** The editor's Silence Length, for a Stream Deck Record. */
    silenceLength: SilenceLength | null;
    /** The Recording Session the editor follows; null while none records. */
    recordingSessionId: string | null;
    /** Recording Sessions the recorder has said are over, oldest first. */
    endedRecordingSessionIds: readonly string[];
    /**
     * The Recording Session whose speech this editor places: from when it
     * follows one until that one's own `recording-stopped` (or
     * `camera-lost`), which comes after its last speech, or until it
     * follows the next. Any other's late events are a replay to ignore.
     */
    placing: string | null;
    /**
     * The Recording Session placed has a Take whose speech has not ended
     * (`take-started`): its end is placed. Speech that was no Take is not.
     */
    placingTake: boolean;
  };

  export type Action =
    | { type: "recorder-message-heard"; message: CvmRecorderMessage }
    | { type: "silence-length-chosen"; silenceLength: SilenceLength }
    | { type: "press-record"; silenceLength: SilenceLength }
    | { type: "press-stop" }
    | { type: "dismiss-alert" }
    | { type: "press-retry" }
    | { type: "press-scene"; scene: Scene }
    | { type: "press-wake-spacedesk" }
    | { type: "retry-screen-failed"; message: string }
    | { type: "switch-scene-failed"; message: string }
    | { type: "retry-camera-failed"; message: string }
    | { type: "start-recording-failed"; message: string }
    | { type: "stop-recording-failed"; message: string };

  export type Effect =
    | { type: "start-recording"; silenceLength: SilenceLength }
    | { type: "stop-recording" }
    | { type: "send-silence-length"; silenceLength: SilenceLength }
    | { type: "retry-camera" }
    | { type: "retry-screen" }
    /** The OBS path's `recording-started`, for a CVM recorder Recording Session. */
    | {
        type: "start-session";
        recordingSessionId: string;
        silenceLength: SilenceLength;
      }
    /** The OBS path's `recording-stopped`. */
    | { type: "stop-session" }
    /** The OBS path's `new-optimistic-clip-detected`. */
    | { type: "start-take"; soundDetectionId: string }
    /** The OBS path's `clip-audio-window-closed`. */
    | { type: "close-take-window" }
    /**
     * Tell the app server where to save this Recording Session's speech
     * (the editor's insertion point, as OBS's polling sends it), and hand
     * the saved Clips to the clip reducer as `new-database-clips`.
     */
    | { type: "place-take"; recordingSessionId: string }
    /** Clips the app server saved without the editor: `new-database-clips`. */
    | {
        type: "show-saved-clips";
        recordingSessionId: string;
        clips: SavedRecorderClip[];
        transcriptionJobId: string;
      }
    | { type: "switch-scene"; scene: Scene };
}

export const createInitialCvmRecorderState = (
  format: VideoFormat = "landscape"
): cvmRecorderReducer.State => ({
  format,
  reachable: null,
  attached: false,
  problem: null,
  phase: "idle",
  camera: { kind: "closed" },
  retrying: false,
  previews: null,
  speech: { type: "warming-up" },
  scene: null,
  screen: null,
  wakingAgain: false,
  error: null,
  alert: null,
  framesLost: null,
  lostFrameSpans: [],
  takeSpans: [],
  silenceLength: null,
  recordingSessionId: null,
  endedRecordingSessionIds: [],
  placing: null,
  placingTake: false,
});

export const CAMERA_LOST_ALERT =
  "The Cam Link stopped sending video, so recording stopped. Everything up to then is kept, Clips included. Check its USB cable, or unplug and replug it, then press Record to carry on.";

export const CRASHED_ALERT =
  "The recorder crashed during the last recording. Its files were repaired and the Clips up to the crash are kept. Press Record to carry on.";

export const canRecord = (state: cvmRecorderReducer.State) =>
  state.reachable === true &&
  state.problem === null &&
  state.phase === "idle" &&
  state.camera.kind === "live" &&
  !isScreenWaking(state) &&
  (state.scene === null || isSceneAvailable(state, state.scene));

export const canSwitchScene = (state: cvmRecorderReducer.State) =>
  state.reachable === true && state.scene !== null;

export const canRetryCamera = (state: cvmRecorderReducer.State) =>
  !state.retrying &&
  (state.camera.kind === "not-starting" || state.camera.kind === "busy");

/** A Short's screen is unavailable: Matt may ask the recorder to wake Spacedesk again. */
export const canWakeSpacedeskAgain = (state: cvmRecorderReducer.State) =>
  state.format === "short" &&
  state.screen?.kind === "unavailable" &&
  state.phase === "idle" &&
  !state.wakingAgain;

const cameraHeard = (
  state: cvmRecorderReducer.State,
  camera: cvmRecorderReducer.Camera
): cvmRecorderReducer.State => ({ ...state, camera, retrying: false });

export const canStop = (state: cvmRecorderReducer.State) =>
  state.phase === "recording";

/** Whether a take is being recorded, as OBS reports "recording". */
export const isCvmRecorderRecording = (state: cvmRecorderReducer.State) =>
  state.phase === "recording" || state.phase === "stopping";

/**
 * Whether a Clip's stills are held (#2214): it belongs to the Recording
 * Session still being recorded (or still placing its last speech), whose
 * files are growing. A still decodes them with ffmpeg on the GPU, which cost
 * the capture frames mid-take; the editor fetches it after Stop instead.
 */
export const holdsStillsOf = (
  state: cvmRecorderReducer.State,
  clip: { recordingSession?: { id: string } | null }
): boolean => {
  const id = clip.recordingSession?.id;
  return (
    id !== undefined &&
    (id === state.recordingSessionId || id === state.placing)
  );
};

/**
 * The loud alert for frames lost INSIDE A CLIP (#2214, #2227): shown
 * mid-take the moment a loss is known to fall in one, naming the Clips hit,
 * and kept after Stop until the next Recording Session. Frames lost between
 * Clips, or with no Clip at all, never raise it; they are still counted
 * (`framesLost`). Each lost frame is a freeze in the file (the CFR filters
 * repeat the last one).
 */
export const framesLostAlert = (
  state: cvmRecorderReducer.State
): string | null =>
  describeFramesLostInClips(state, isCvmRecorderRecording(state));

const WARMING_UP: FrontendSpeechDetectorState = { type: "warming-up" };
const SILENCE: FrontendSpeechDetectorState = { type: "silence" };

/** Enough to recognise any late replay; a page records far fewer. */
const ENDED_KEPT = 50;

const ended = (
  state: cvmRecorderReducer.State,
  id: string | null
): readonly string[] =>
  id === null || state.endedRecordingSessionIds.includes(id)
    ? state.endedRecordingSessionIds
    : [...state.endedRecordingSessionIds, id].slice(-ENDED_KEPT);

/**
 * Whether a Recording Session's event is the editor's to follow: the current
 * one's always; the stop of one just over, while nothing else records or
 * starts, for what it reports. Anything else is a late replay.
 */
const follows = (
  state: cvmRecorderReducer.State,
  message: Extract<CvmRecorderMessage, { recordingSessionId: string }>
): boolean => {
  const id = message.recordingSessionId;
  if (id === state.recordingSessionId) return true;
  switch (message.type) {
    case "recording-started":
      // A Stream Deck Record can be heard before the status that names it.
      return (
        !state.endedRecordingSessionIds.includes(id) &&
        state.phase !== "recording" &&
        state.phase !== "stopping"
      );
    case "recording-stopped":
    case "camera-lost":
      return (
        state.recordingSessionId === null &&
        state.phase === "idle" &&
        state.endedRecordingSessionIds.at(-1) === id
      );
    case "warmed-up":
    case "speech-started":
    case "take-started":
    case "speech-ended":
    case "clips-saved":
    // A late total: `recording-stopped` carries the final one.
    case "frames-lost":
      return false;
  }
};

/** A Recording Session stopped: the editor follows none until the next. */
const over = (state: cvmRecorderReducer.State, id: string) => ({
  recordingSessionId: null,
  endedRecordingSessionIds: ended(state, id),
});

const heard = (
  state: cvmRecorderReducer.State,
  message: CvmRecorderMessage
): cvmRecorderReducer.State => {
  if ("recordingSessionId" in message && message.type !== "recorder-status") {
    if (!follows(state, message)) return state;
  }
  switch (message.type) {
    case "recorder-status": {
      const recording = message.recordingSessionId !== null;
      const current = state.recordingSessionId;
      const endedIds =
        current !== null && current !== message.recordingSessionId
          ? ended(state, current)
          : state.endedRecordingSessionIds;
      return {
        ...state,
        // The recorder's word on what records now is the truth.
        recordingSessionId: message.recordingSessionId,
        endedRecordingSessionIds: endedIds,
        reachable: message.reachable,
        problem: message.problem,
        previews: message.previews,
        camera: message.reachable ? state.camera : { kind: "closed" },
        scene: message.reachable ? state.scene : null,
        screen: message.reachable ? state.screen : null,
        phase: recording
          ? state.phase === "stopping"
            ? "stopping"
            : "recording"
          : state.phase === "starting"
            ? "starting"
            : "idle",
        // Joined mid-take, nothing is known until the recorder next hears.
        speech: recording && state.phase !== "idle" ? state.speech : WARMING_UP,
      };
    }
    case "camera-opening":
      return cameraHeard(state, { kind: "opening", attempt: message.attempt });
    case "camera-went-live":
      return cameraHeard(state, { kind: "live" });
    case "cam-link-not-starting":
      return cameraHeard(state, {
        kind: "not-starting",
        message: message.message,
      });
    case "cam-link-busy":
      return cameraHeard(state, { kind: "busy", message: message.message });
    case "camera-closed":
      return {
        ...cameraHeard(state, { kind: "closed" }),
        scene: null,
        screen: null,
      };
    case "scene-changed":
      return { ...state, scene: message.scene };
    case "screen-changed":
      return { ...state, screen: message.screen, wakingAgain: false };
    case "recording-started":
      return {
        ...state,
        phase: "recording",
        speech: WARMING_UP,
        error: null,
        recordingSessionId: message.recordingSessionId,
      };
    case "warmed-up":
      return { ...state, speech: SILENCE };
    case "speech-started":
      return { ...state, speech: { type: "speaking-detected" } };
    case "take-started":
      // The speech is a take now, as OBS's detector makes it one.
      return {
        ...state,
        speech: {
          type: "long-enough-speaking-for-clip-detected",
          soundDetectionId: message.takeId,
        },
      };
    case "speech-ended":
      return { ...state, speech: SILENCE };
    case "camera-lost":
      return {
        ...state,
        ...over(state, message.recordingSessionId),
        phase: "idle",
        speech: WARMING_UP,
        // Gone until the recorder reopens it and it goes live again.
        camera: { kind: "closed" },
        alert: CAMERA_LOST_ALERT,
        error: message.errors.length > 0 ? message.errors.join("\n") : null,
      };
    case "recording-stopped":
      return {
        ...state,
        ...over(state, message.recordingSessionId),
        phase: "idle",
        speech: WARMING_UP,
        error:
          message.errors.length > 0 ? message.errors.join("\n") : state.error,
        alert: message.crashed ? CRASHED_ALERT : state.alert,
        // A crash counted nothing more: what was heard live stands.
        framesLost: message.framesLost ?? state.framesLost,
      };
    case "frames-lost":
      return { ...state, framesLost: message.framesLost };
    case "recorder-failed":
      return { ...state, error: message.message };
    case "clips-saved":
      return state;
  }
};

export const cvmRecorderReducer: EffectReducer<
  cvmRecorderReducer.State,
  cvmRecorderReducer.Action,
  cvmRecorderReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "recorder-message-heard": {
      const followed = heard(state, action.message);
      const next = attach(
        trackFramesLost(
          state,
          placeClips(state, followed, action.message, exec),
          action.message
        ),
        action.message,
        exec
      );
      // A new or restarted app server knows nothing of the editor's choice.
      if (
        action.message.type === "recorder-status" &&
        next.reachable === true &&
        next.silenceLength
      )
        exec({
          type: "send-silence-length",
          silenceLength: next.silenceLength,
        });
      return next;
    }
    case "silence-length-chosen":
      // Until the app server first answers, its recorder-status sends it.
      if (
        state.reachable === true &&
        action.silenceLength !== state.silenceLength
      )
        exec({
          type: "send-silence-length",
          silenceLength: action.silenceLength,
        });
      return { ...state, silenceLength: action.silenceLength };
    case "press-record":
      if (!canRecord(state)) return state;
      exec({ type: "start-recording", silenceLength: action.silenceLength });
      return {
        ...state,
        phase: "starting",
        error: null,
        alert: null,
        framesLost: null,
        lostFrameSpans: [],
        takeSpans: [],
      };
    case "dismiss-alert":
      return { ...state, alert: null };
    case "press-stop":
      if (!canStop(state)) return state;
      exec({ type: "stop-recording" });
      return { ...state, phase: "stopping" };
    case "press-retry":
      if (!canRetryCamera(state)) return state;
      exec({ type: "retry-camera" });
      return { ...state, retrying: true, error: null };
    case "press-scene":
      if (
        !canSwitchScene(state) ||
        action.scene === state.scene ||
        !isSceneAvailable(state, action.scene)
      )
        return state;
      exec({ type: "switch-scene", scene: action.scene });
      return { ...state, error: null };
    case "switch-scene-failed":
      return { ...state, error: action.message };
    case "press-wake-spacedesk":
      if (!canWakeSpacedeskAgain(state)) return state;
      exec({ type: "retry-screen" });
      return { ...state, wakingAgain: true, error: null };
    case "retry-screen-failed":
      return { ...state, wakingAgain: false, error: action.message };
    case "retry-camera-failed":
      return { ...state, retrying: false, error: action.message };
    case "start-recording-failed":
      return {
        ...state,
        phase: state.phase === "starting" ? "idle" : state.phase,
        error: action.message,
      };
    case "stop-recording-failed":
      return {
        ...state,
        phase: state.phase === "stopping" ? "recording" : state.phase,
        error: action.message,
      };
  }
};
