import type { EffectReducer } from "use-effect-reducer";
import type { Scene } from "@/packages/scene-layout";
import {
  DEFAULT_SILENCE_LENGTH,
  type SilenceLength,
} from "@/silence-detection-constants";
import type { VideoFormat } from "@/features/videos/video-format";
import type {
  FramesLost,
  LostFrameSpan,
  ScreenStatus,
} from "recorder-service/protocol";
import type {
  StreamHealth,
  StreamStatus,
} from "recorder-service/stream-protocol";
import { isSceneAvailable, isScreenWaking } from "./cvm-recorder-screen";
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
import {
  createInitialRecorderSessionState,
  follows,
  recorderSessionReducer,
  canPressStop,
  followedOnLeave,
} from "./recorder-session-reducer";

/**
 * The CVM recorder in the editor. The recorder service records; this
 * follows what the app server reports of it (`recorder-message-heard`).
 * The Stream Deck starts a recording; the editor shows what the recorder
 * says, and asks for Stop only when Matt leaves the editor (New Short, any
 * other page, a reload).
 *
 * The Cam Link opens when the editor opens (the app server's recorder client
 * opens the recorder while an editor listens); "Ready to record" waits for
 * `camera-went-live`, and the replug and Close-OBS messages wait for Retry.
 *
 * Scenes: the preview draws the scene the recorder says it is in
 * (`scene-changed`); the Stream Deck switches it.
 *
 * A Short's screen is the Spacedesk display, which the recorder wakes when it
 * opens (`screen-changed`): until it is ready, only scenes that do not draw
 * the screen (Camera) may be recorded in, and once it is
 * unavailable Matt may wake Spacedesk again (`cvm-recorder-screen.ts`).
 *
 * The Stream Deck records, stops and switches scenes on the recorder service
 * directly, and the editor follows the messages it hears. For a Stream Deck
 * Record to use the editor's
 * Silence Length, the editor tells the app server its choice whenever it
 * changes and whenever the recorder reports in.
 *
 * The Recording Session, its speech, Attaching and the clip effects are the
 * `recorderSessionReducer` (ADR 0050): this reducer turns the recorder's
 * messages into its events, and keeps the device (camera, scenes, screen, frames lost) and where a Take saves.
 *
 * Speech: the recorder's silence detection, fed to the shared speech state
 * machine (`speechDetectorReducer`), so the editor and the teleprompter show
 * a take the same whichever Recorder films it. Record warms up until the
 * recorder hears the first silence (`warmed-up`); speech shows as speaking,
 * then as long enough for a Clip when the recorder says it is a Take
 * (`take-started`). The editor never times speech itself: the recorder
 * service alone decides what is a Take, by the rule its Clip is cut with, so
 * every Optimistic Clip gets a Clip. A silence as long as the Silence Length
 * (`speech-ended`) closes it.
 *
 * Sessions: the editor follows the Recording Session the recorder says is
 * recording (`recorder-status`) or that just started. A Recording Session's
 * events can arrive late (held behind a save that failed, then replayed from
 * its start), so an event of any other Recording Session is ignored (#2163).
 * The stop of the one just recorded still reports its errors and frames lost
 * when it lands after the status.
 *
 * Clips: this is an adapter onto the clip reducer's clip logic, which does
 * all the placing (`clip-state-reducer-recording.ts`; ADR 0044). At a Take's
 * end the editor tells the app server where to save it, and hears back the
 * saved Clips (`place-take`). The app server's
 * status can say a Recording Session stopped before its last speech is
 * saved, so the editor places a Recording Session's speech from when it
 * follows it until that Recording Session's own stop, or the next one
 * starts (`placing`).
 */
export namespace cvmRecorderReducer {
  export type Phase = recorderSessionReducer.Phase;

  export type Camera =
    | { kind: "closed" }
    | { kind: "opening"; attempt: number }
    | { kind: "live" }
    | { kind: "not-starting"; message: string }
    | { kind: "busy"; message: string };

  /** The Recording Session followed is the shared reducer's. */
  export type State = recorderSessionReducer.State & {
    /** The Video's format: a Short is drawn, and recorded, 9:16. */
    format: VideoFormat;
    /** Null until the app server first says. */
    reachable: boolean | null;
    /** The app server is starting the recorder service (ADR 0053). */
    starting: boolean;
    /** Why the recorder cannot record at all (a wrong ffmpeg). */
    problem: string | null;
    camera: Camera;
    /** Retry was pressed and the camera has not started opening again yet. */
    retrying: boolean;
    /** Where the browser watches the raw camera and screen. */
    previews: { camera: string; screen: string } | null;
    /** The scene the recorder draws; null while it is not open for this Video. */
    scene: Scene | null;
    /** A Short's screen; null while not open for this Video, and for Landscape. */
    screen: ScreenStatus | null;
    /** The Live Stream (ADR 0054); null while the recorder is not open for this Video. */
    stream: StreamStatus | null;
    /** The Live Stream's latest health; null until it says, and while not open for this Video. */
    streamHealth: StreamHealth | null;
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
    | { type: "press-stop" }
    | { type: "dismiss-alert" }
    | { type: "press-retry" }
    | { type: "press-wake-spacedesk" }
    | { type: "retry-screen-failed"; message: string }
    | { type: "retry-camera-failed"; message: string }
    | { type: "stop-recording-failed"; message: string };

  export type Effect =
    /** Stop, the session's clip effects, and a log of the unexpected. */
    | recorderSessionReducer.Effect
    | { type: "send-silence-length"; silenceLength: SilenceLength }
    | { type: "retry-camera" }
    | { type: "retry-screen" }
    /**
     * Tell the app server where to save this Recording Session's speech
     * (the editor's insertion point), and hand
     * the saved Clips to the clip reducer as `new-database-clips`.
     */
    | { type: "place-take"; recordingSessionId: string }
    /** Clips the app server saved without the editor: `new-database-clips`. */
    | {
        type: "show-saved-clips";
        recordingSessionId: string;
        clips: SavedRecorderClip[];
        transcriptionJobId: string;
      };
}

export const createInitialCvmRecorderState = (
  format: VideoFormat = "landscape"
): cvmRecorderReducer.State => ({
  ...createInitialRecorderSessionState(),
  format,
  reachable: null,
  starting: false,
  problem: null,
  camera: { kind: "closed" },
  retrying: false,
  previews: null,
  scene: null,
  screen: null,
  stream: null,
  streamHealth: null,
  wakingAgain: false,
  error: null,
  alert: null,
  framesLost: null,
  lostFrameSpans: [],
  takeSpans: [],
  silenceLength: null,
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

export const canStop = (state: cvmRecorderReducer.State) => canPressStop(state);

export { followedOnLeave };

/** Whether a take is being recorded (or stopping). */
export const isCvmRecorderRecording = (state: cvmRecorderReducer.State) =>
  state.phase === "recording" || state.phase === "stopping";

/**
 * Whether the editor's Recording Session still needs the recorder: it is
 * recording or stopping, or its last Take is still being placed. An editor
 * never lets the recorder go meanwhile (`recorder-attention-reducer.ts`).
 */
export const holdsRecordingSession = (state: cvmRecorderReducer.State) =>
  isCvmRecorderRecording(state) ||
  state.recordingSessionId !== null ||
  state.placing !== null;

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
 * Which Stop the editor's stills were last asked for after: a new value at
 * each Stop. A still asked for mid-session is answered 503 at once (the
 * server's Still Gate never parks the request, `still-gate.ts`), so a still
 * `<img>` is keyed on this and asks again once the session is over.
 */
export const stillRound = (state: cvmRecorderReducer.State): string =>
  state.endedRecordingSessionIds.at(-1) ?? "";

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

/** The message as the shared session reducer hears it, if it is one. */
const sessionEventOf = (
  state: cvmRecorderReducer.State,
  message: CvmRecorderMessage
): recorderSessionReducer.Event | null => {
  switch (message.type) {
    case "recorder-status":
      return {
        type: "recorder-reported",
        reachable: message.reachable,
        recordingSessionId: message.recordingSessionId,
        silenceLength: state.silenceLength ?? DEFAULT_SILENCE_LENGTH,
      };
    case "recording-started":
      // The recorder service gates a CVM Record before it starts (ADR 0038).
      return {
        type: "recording-started",
        recordingSessionId: message.recordingSessionId,
        silenceLength: message.silenceLength,
      };
    case "recording-stopped":
    case "camera-lost":
      return {
        type: "recording-stopped",
        recordingSessionId: message.recordingSessionId,
      };
    case "warmed-up":
    case "speech-ended":
      return {
        type: "speech-heard",
        recordingSessionId: message.recordingSessionId,
        heard: { type: "silence-started" },
      };
    case "speech-started":
      // The wire carries no audio time: only `take-started` makes a Take.
      return {
        type: "speech-heard",
        recordingSessionId: message.recordingSessionId,
        heard: { type: "silence-ended" },
      };
    case "take-started":
      return {
        type: "speech-heard",
        recordingSessionId: message.recordingSessionId,
        heard: { type: "take-started", soundDetectionId: message.takeId },
      };
    case "camera-opening":
    case "camera-went-live":
    case "cam-link-not-starting":
    case "cam-link-busy":
    case "camera-closed":
    case "scene-changed":
    case "screen-changed":
    case "stream-changed":
    case "stream-health":
    case "frames-lost":
    case "recorder-failed":
    case "clips-saved":
      return null;
  }
};

/** Whether the message is the editor's to hear (`follows`). */
const isHeard = (
  state: cvmRecorderReducer.State,
  message: CvmRecorderMessage
): boolean => {
  if (!("recordingSessionId" in message) || message.type === "recorder-status")
    return true;
  switch (message.type) {
    case "recording-started":
      return follows(state, "recording-started", message.recordingSessionId);
    case "recording-stopped":
    case "camera-lost":
      return follows(state, "recording-stopped", message.recordingSessionId);
    // Of the one followed only; `recording-stopped` carries a late total.
    case "frames-lost":
    case "warmed-up":
    case "speech-started":
    case "take-started":
    case "speech-ended":
    case "clips-saved":
      return follows(state, "other", message.recordingSessionId);
  }
};

/** The device's half of a message the editor hears. */
const deviceHeard = (
  state: cvmRecorderReducer.State,
  message: CvmRecorderMessage
): cvmRecorderReducer.State => {
  switch (message.type) {
    case "recorder-status":
      return {
        ...state,
        reachable: message.reachable,
        starting: message.starting,
        problem: message.problem,
        previews: message.previews,
        camera: message.reachable ? state.camera : { kind: "closed" },
        scene: message.reachable ? state.scene : null,
        screen: message.reachable ? state.screen : null,
        stream: message.reachable ? state.stream : null,
        streamHealth: message.reachable ? state.streamHealth : null,
      };
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
        stream: null,
        streamHealth: null,
      };
    case "scene-changed":
      return { ...state, scene: message.scene };
    case "screen-changed":
      return { ...state, screen: message.screen, wakingAgain: false };
    case "stream-changed":
      return { ...state, stream: message.stream };
    case "stream-health":
      return { ...state, streamHealth: message.health };
    case "recording-started":
      return { ...state, error: null };
    case "camera-lost":
      return {
        ...state,
        // Gone until the recorder reopens it and it goes live again.
        camera: { kind: "closed" },
        alert: CAMERA_LOST_ALERT,
        error: message.errors.length > 0 ? message.errors.join("\n") : null,
      };
    case "recording-stopped":
      return {
        ...state,
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
    case "warmed-up":
    case "speech-started":
    case "take-started":
    case "speech-ended":
    case "clips-saved":
      return state;
  }
};

const heard = (
  state: cvmRecorderReducer.State,
  message: CvmRecorderMessage,
  exec: (effect: cvmRecorderReducer.Effect) => void
): cvmRecorderReducer.State => {
  if (!isHeard(state, message)) return state;
  const event = sessionEventOf(state, message);
  return deviceHeard(
    event ? recorderSessionReducer(state, event, exec) : state,
    message
  );
};

export const cvmRecorderReducer: EffectReducer<
  cvmRecorderReducer.State,
  cvmRecorderReducer.Action,
  cvmRecorderReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "recorder-message-heard": {
      const followed = heard(state, action.message, exec);
      const next = trackFramesLost(
        state,
        placeClips(state, followed, action.message, exec),
        action.message
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
    case "dismiss-alert":
      return { ...state, alert: null };
    case "press-stop":
      return recorderSessionReducer(state, { type: "press-stop" }, exec);
    case "press-retry":
      if (!canRetryCamera(state)) return state;
      exec({ type: "retry-camera" });
      return { ...state, retrying: true, error: null };
    case "press-wake-spacedesk":
      if (!canWakeSpacedeskAgain(state)) return state;
      exec({ type: "retry-screen" });
      return { ...state, wakingAgain: true, error: null };
    case "retry-screen-failed":
      return { ...state, wakingAgain: false, error: action.message };
    case "retry-camera-failed":
      return { ...state, retrying: false, error: action.message };
    case "stop-recording-failed":
      return {
        ...recorderSessionReducer(
          state,
          { type: "stop-recording-failed" },
          exec
        ),
        error: action.message,
      };
  }
};
