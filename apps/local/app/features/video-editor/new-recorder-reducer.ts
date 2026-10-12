import type { EffectReducer } from "use-effect-reducer";
import type { Scene } from "@/packages/scene-layout";
import type { InsertionPoint } from "@/services/clip-service";
import type { SilenceLength } from "@/silence-detection-constants";
import type { FramesLost } from "recorder-service/protocol";
import type { NewRecorderMessage } from "./new-recorder-wire";

/**
 * The New recorder's Record and Stop in the editor. The recorder service
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
 * The Stream Deck records, stops and switches scenes on the recorder service
 * directly: the editor hears the same messages as for its own buttons, so it
 * follows them the same way. For a Stream Deck Record to use the editor's
 * Silence Length, the editor tells the app server its choice whenever it
 * changes and whenever the recorder reports in.
 */
export namespace newRecorderReducer {
  export type Phase = "idle" | "starting" | "recording" | "stopping";

  export type Camera =
    | { kind: "closed" }
    | { kind: "opening"; attempt: number }
    | { kind: "live" }
    | { kind: "not-starting"; message: string }
    | { kind: "busy"; message: string };

  export type State = {
    /** Null until the app server first says. */
    reachable: boolean | null;
    /** Why the recorder cannot record at all (a wrong ffmpeg). */
    problem: string | null;
    phase: Phase;
    camera: Camera;
    /** Retry was pressed and the camera has not started opening again yet. */
    retrying: boolean;
    /** Where the browser watches the raw camera and screen. */
    previews: { camera: string; screen: string } | null;
    speaking: boolean;
    /** The scene the recorder draws; null while it is not open for this Video. */
    scene: Scene | null;
    /** The last thing that went wrong, until the next Record. */
    error: string | null;
    /**
     * Something Matt must see at once (the camera lost mid-recording, a
     * Recording Session cut off by a crash), until he dismisses it.
     */
    alert: string | null;
    /** The last Recording Session's frames lost, until the next Record. */
    framesLost: FramesLost | null;
    /** The editor's Silence Length, for a Stream Deck Record. */
    silenceLength: SilenceLength | null;
  };

  export type Action =
    | { type: "recorder-message-heard"; message: NewRecorderMessage }
    | { type: "silence-length-chosen"; silenceLength: SilenceLength }
    | {
        type: "press-record";
        silenceLength: SilenceLength;
        insertionPoint: InsertionPoint;
      }
    | { type: "press-stop" }
    | { type: "dismiss-alert" }
    | { type: "press-retry" }
    | { type: "press-scene"; scene: Scene }
    | { type: "switch-scene-failed"; message: string }
    | { type: "retry-camera-failed"; message: string }
    | { type: "start-recording-failed"; message: string }
    | { type: "stop-recording-failed"; message: string };

  export type Effect =
    | {
        type: "start-recording";
        silenceLength: SilenceLength;
        insertionPoint: InsertionPoint;
      }
    | { type: "stop-recording" }
    | { type: "send-silence-length"; silenceLength: SilenceLength }
    | { type: "retry-camera" }
    | { type: "switch-scene"; scene: Scene };
}

export const createInitialNewRecorderState = (): newRecorderReducer.State => ({
  reachable: null,
  problem: null,
  phase: "idle",
  camera: { kind: "closed" },
  retrying: false,
  previews: null,
  speaking: false,
  scene: null,
  error: null,
  alert: null,
  framesLost: null,
  silenceLength: null,
});

export const CAMERA_LOST_ALERT =
  "The Cam Link stopped sending video, so recording stopped. Everything up to then is kept, Clips included. Check its USB cable, or unplug and replug it, then press Record to carry on.";

export const CRASHED_ALERT =
  "The recorder crashed during the last recording. Its files were repaired and the Clips up to the crash are kept. Press Record to carry on.";

export const canRecord = (state: newRecorderReducer.State) =>
  state.reachable === true &&
  state.problem === null &&
  state.phase === "idle" &&
  state.camera.kind === "live";

export const canSwitchScene = (state: newRecorderReducer.State) =>
  state.reachable === true && state.scene !== null;

export const canRetryCamera = (state: newRecorderReducer.State) =>
  !state.retrying &&
  (state.camera.kind === "not-starting" || state.camera.kind === "busy");

const cameraHeard = (
  state: newRecorderReducer.State,
  camera: newRecorderReducer.Camera
): newRecorderReducer.State => ({ ...state, camera, retrying: false });

export const canStop = (state: newRecorderReducer.State) =>
  state.phase === "recording";

const heard = (
  state: newRecorderReducer.State,
  message: NewRecorderMessage
): newRecorderReducer.State => {
  switch (message.type) {
    case "recorder-status": {
      const recording = message.recordingSessionId !== null;
      return {
        ...state,
        reachable: message.reachable,
        problem: message.problem,
        previews: message.previews,
        camera: message.reachable ? state.camera : { kind: "closed" },
        scene: message.reachable ? state.scene : null,
        phase: recording
          ? state.phase === "stopping"
            ? "stopping"
            : "recording"
          : state.phase === "starting"
            ? "starting"
            : "idle",
        speaking: recording && state.speaking,
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
      return { ...cameraHeard(state, { kind: "closed" }), scene: null };
    case "scene-changed":
      return { ...state, scene: message.scene };
    case "recording-started":
      return { ...state, phase: "recording", speaking: false, error: null };
    case "speech-started":
      return { ...state, speaking: true };
    case "speech-ended":
      return { ...state, speaking: false };
    case "camera-lost":
      return {
        ...state,
        phase: "idle",
        speaking: false,
        // Gone until the recorder reopens it and it goes live again.
        camera: { kind: "closed" },
        alert: CAMERA_LOST_ALERT,
        error: message.errors.length > 0 ? message.errors.join("\n") : null,
      };
    case "recording-stopped":
      return {
        ...state,
        phase: "idle",
        speaking: false,
        error:
          message.errors.length > 0 ? message.errors.join("\n") : state.error,
        alert: message.crashed ? CRASHED_ALERT : state.alert,
        framesLost: message.framesLost,
      };
    case "recorder-failed":
      return { ...state, error: message.message };
    case "clips-saved":
      return state;
  }
};

export const newRecorderReducer: EffectReducer<
  newRecorderReducer.State,
  newRecorderReducer.Action,
  newRecorderReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "recorder-message-heard": {
      const next = heard(state, action.message);
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
      exec({
        type: "start-recording",
        silenceLength: action.silenceLength,
        insertionPoint: action.insertionPoint,
      });
      return {
        ...state,
        phase: "starting",
        error: null,
        alert: null,
        framesLost: null,
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
      if (!canSwitchScene(state) || action.scene === state.scene) return state;
      exec({ type: "switch-scene", scene: action.scene });
      return { ...state, error: null };
    case "switch-scene-failed":
      return { ...state, error: action.message };
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
