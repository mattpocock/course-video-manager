import type { EffectReducer } from "use-effect-reducer";
import type { SilenceLength } from "@/silence-detection-constants";
import {
  calibrationValidity,
  RECORDER_CAMERA_NAME,
  describeCalibrationRefusal,
  type LastPassedCalibration,
} from "@/av-calibration-constants";
import {
  createInitialSpeechDetectorState,
  speechDetectorReducer,
  toFrontendSpeechDetectorState,
} from "./speech-detector-reducer";

export type OBSNotRunningState = {
  type: "obs-not-running";
};

export type OBSCheckingConnectionStatusState = {
  type: "checking-obs-connection-status";
};

export type OBSConnectedState = {
  type: "obs-connected";
  profile: string;
  scene: string;
  latestOutputPath: string | null;
  /**
   * Why CVM stopped the recording OBS last started (the AV Calibration
   * gate, ADR 0038), until a recording is let through.
   */
  calibrationRefusal?: string;
};

export type OBSRecordingState = {
  type: "obs-recording";
  profile: string;
  scene: string;
  latestOutputPath: string;
  /**
   * The silence threshold this take cuts with, fixed when it started (that
   * of the AV Calibration it was let through under): the browser detector
   * and the after-recording FFmpeg pass both use it, whatever is calibrated
   * since.
   */
  silenceThresholdDb: number;
};

export type OBSConnectionOuterState =
  OBSNotRunningState | OBSConnectedState | OBSRecordingState;

/**
 * The Video records with the CVM recorder, so the editor leaves OBS alone:
 * no connection, no profile switch, no Virtual Camera. Reads as
 * `obs-not-running` outside the connector.
 */
export type OBSNotUsedState = {
  type: "obs-not-used";
};

export type OBSConnectionInnerState =
  | OBSNotUsedState
  | OBSNotRunningState
  | OBSCheckingConnectionStatusState
  | OBSConnectedState
  | OBSRecordingState;

/**
 * OBS in the editor: its websocket connection, the recording it reports,
 * and the browser's speech detector on the mic. Like `cvmRecorderReducer`,
 * it sends the clip reducer what that means (ADR 0044): a recording followed
 * starts and stops a Recording Session (`start-session`, `stop-session`),
 * speech held for the minimum Clip length is a Take (`start-take`), and
 * silence closes its audio window (`close-take-window`).
 *
 * Attaching: a connect that finds OBS recording a take this page does not
 * follow (a page refreshed or closed mid-take) asks OBS to stop it, as the
 * CVM recorder's Attaching does. A reconnect mid-take re-attaches to the
 * recording it follows, and stops nothing (#2198): OBS only stops on the
 * gate, on Stop, and when a page finds a take it does not follow.
 */
export namespace obsConnectorReducer {
  export type State = {
    obs: OBSConnectionInnerState;
    /** The browser's speech detector; read while OBS records. */
    speech: speechDetectorReducer.State;
    /**
     * The recording followed when the websocket dropped: still followed, so
     * its Recording Session goes on, until a reconnect says whether OBS
     * still records it.
     */
    interrupted: OBSRecordingState | null;
  };

  export type Action =
    | {
        type: "obs-connected";
        profile: string;
        scene: string;
        /** Whether OBS is recording as the connection opens. */
        recording: boolean;
      }
    | {
        type: "obs-connection-failed";
        error: unknown;
      }
    | {
        type: "connection-closed";
      }
    | {
        type: "trigger-reconnect";
      }
    | {
        type: "profile-changed";
        profile: string;
      }
    | {
        type: "recording-started";
        outputPath: string;
        /** The editor's latest calibration passed under today's rules, then. */
        lastPassed: LastPassedCalibration | null;
        /** The label of the editor's mic track then; null with none open. */
        browserInputLabel: string | null;
        /** The editor's Silence Length then: the Recording Session's. */
        silenceLength: SilenceLength;
        nowMs: number;
      }
    | {
        type: "recording-stopped";
        outputPath: string;
      }
    | {
        type: "scene-changed";
        scene: string;
      }
    | {
        /** The Video's Recorder is (now) OBS, or (now) not. */
        type: "video-recorder-changed";
        usesObs: boolean;
      }
    | {
        /** What the silence scan heard of the mic. */
        type: "speech-heard";
        heard: speechDetectorReducer.Action;
      };

  export type Effect =
    | { type: "stop-recording" }
    | { type: "log-error"; error: unknown }
    | { type: "wait-before-reconnecting" }
    | { type: "attempt-to-connect" }
    | { type: "run-event-listeners" }
    | { type: "disconnect" }
    /** The clip reducer's `recording-started`. */
    | {
        type: "start-session";
        outputPath: string;
        silenceLength: SilenceLength;
        silenceThresholdDb: number;
      }
    /** The clip reducer's `recording-stopped`. */
    | { type: "stop-session" }
    /** The clip reducer's `new-optimistic-clip-detected`. */
    | {
        type: "start-take";
        scene: string;
        profile: string;
        soundDetectionId: string;
      }
    /** The clip reducer's `clip-audio-window-closed`. */
    | { type: "close-take-window" };
}

type Exec = (effect: obsConnectorReducer.Effect) => void;

/** OBS Videos connect at once, exactly as before the Recorder choice. */
export const createInitialOBSConnectorState = (
  usesObs: boolean,
  exec: Exec
): obsConnectorReducer.State => {
  const speech = createInitialSpeechDetectorState();
  if (!usesObs)
    return { obs: { type: "obs-not-used" }, speech, interrupted: null };
  exec({ type: "attempt-to-connect" });
  return {
    obs: { type: "checking-obs-connection-status" },
    speech,
    interrupted: null,
  };
};

/** The connection alone: what OBS reports, and the gate. */
const connection = (
  state: OBSConnectionInnerState,
  action: Exclude<obsConnectorReducer.Action, { type: "speech-heard" }>,
  exec: Exec
): OBSConnectionInnerState => {
  if (action.type === "video-recorder-changed") {
    if (action.usesObs) {
      return state.type === "obs-not-used"
        ? createInitialOBSConnectorState(true, exec).obs
        : state;
    }
    if (state.type === "obs-not-used") return state;
    exec({ type: "disconnect" });
    return { type: "obs-not-used" };
  }

  // A CVM recorder Video ignores whatever OBS still reports.
  if (state.type === "obs-not-used") {
    if (action.type === "obs-connected") exec({ type: "disconnect" });
    return state;
  }

  switch (action.type) {
    case "obs-connected":
      exec({ type: "run-event-listeners" });
      return {
        type: "obs-connected",
        profile: action.profile,
        scene: action.scene,
        latestOutputPath: null,
      };
    case "obs-connection-failed":
      exec({ type: "log-error", error: action.error });
      exec({ type: "wait-before-reconnecting" });
      return { type: "obs-not-running" };
    case "trigger-reconnect":
      exec({ type: "attempt-to-connect" });
      return { type: "checking-obs-connection-status" };
    case "connection-closed":
      exec({ type: "attempt-to-connect" });
      return { type: "obs-not-running" };
    case "profile-changed": {
      if (state.type === "obs-recording" || state.type === "obs-connected") {
        return { ...state, profile: action.profile };
      }

      throw new Error("Profile changed but not recording or connected");
    }
    case "scene-changed": {
      if (state.type === "obs-recording" || state.type === "obs-connected") {
        return { ...state, scene: action.scene };
      }

      throw new Error("Scene changed but not recording or connected");
    }
    case "recording-started": {
      if (state.type === "obs-connected") {
        // THE GATE (ADR 0038): a take OBS started without a fresh AV
        // Calibration on this camera + mic pair is stopped at once, and the
        // editor says why. OBS cannot say which camera it records: the
        // recorder service's is taken as it. Only here, at its start: a take
        // let through runs to its end.
        const gate = calibrationValidity(
          action.lastPassed,
          {
            browserInputLabel: action.browserInputLabel,
            camera: RECORDER_CAMERA_NAME,
          },
          action.nowMs
        );
        if (!gate.valid) {
          exec({ type: "stop-recording" });
          return {
            ...state,
            calibrationRefusal: describeCalibrationRefusal(gate.reason),
          };
        }
        return {
          type: "obs-recording",
          profile: state.profile,
          scene: state.scene,
          latestOutputPath: action.outputPath,
          silenceThresholdDb: gate.calibration.thresholdDb,
        };
      }

      throw new Error("Obs recording but not connected");
    }
    case "recording-stopped": {
      if (state.type === "obs-recording") {
        return {
          type: "obs-connected",
          profile: state.profile,
          scene: state.scene,
          latestOutputPath: action.outputPath,
        };
      }

      if (state.type === "obs-connected") {
        return { ...state, latestOutputPath: action.outputPath };
      }

      throw new Error("Obs stopped recording but not recording or connected");
    }
  }
};

/**
 * A connect while a recording was followed when the websocket dropped:
 * OBS still recording it re-attaches; OBS no longer recording ends it.
 * A connect with no recording followed stops any OBS is making (Attaching).
 */
const attach = (
  state: obsConnectorReducer.State,
  action: Extract<obsConnectorReducer.Action, { type: "obs-connected" }>,
  exec: Exec
): obsConnectorReducer.State => {
  const obs = connection(state.obs, action, exec);
  if (obs.type !== "obs-connected") return { ...state, obs };
  const followed = state.interrupted;
  if (followed && action.recording)
    return {
      ...state,
      obs: { ...followed, profile: obs.profile, scene: obs.scene },
      interrupted: null,
    };
  if (followed)
    return {
      ...state,
      obs: { ...obs, latestOutputPath: followed.latestOutputPath },
      interrupted: null,
    };
  if (action.recording) exec({ type: "stop-recording" });
  return { ...state, obs };
};

const following = (state: obsConnectorReducer.State) =>
  state.obs.type === "obs-recording" || state.interrupted !== null;

/** What the speech detector's change means for a Take, while OBS records. */
const takeEffects = (
  before: speechDetectorReducer.State,
  after: speechDetectorReducer.State,
  obs: OBSConnectionInnerState,
  exec: Exec
) => {
  if (obs.type !== "obs-recording") return;
  const was = toFrontendSpeechDetectorState(before);
  const is = toFrontendSpeechDetectorState(after);
  if (
    was.type === "speaking-detected" &&
    is.type === "long-enough-speaking-for-clip-detected"
  )
    exec({
      type: "start-take",
      scene: obs.scene,
      profile: obs.profile,
      soundDetectionId: is.soundDetectionId,
    });
  else if (was.type !== "silence" && is.type === "silence")
    exec({ type: "close-take-window" });
};

export const obsConnectorReducer: EffectReducer<
  obsConnectorReducer.State,
  obsConnectorReducer.Action,
  obsConnectorReducer.Effect
> = (state, action, exec) => {
  if (action.type === "speech-heard") {
    if (state.obs.type === "obs-not-used") return state;
    const speech = speechDetectorReducer(state.speech, action.heard);
    takeEffects(state.speech, speech, state.obs, exec);
    return { ...state, speech };
  }

  let next: obsConnectorReducer.State;
  if (action.type === "obs-connected") next = attach(state, action, exec);
  else {
    const obs = connection(state.obs, action, exec);
    // The websocket dropped mid-take: OBS records on, and so does the take.
    const dropped =
      state.obs.type === "obs-recording" && action.type === "connection-closed"
        ? state.obs
        : null;
    next = {
      ...state,
      obs,
      interrupted:
        dropped ?? (obs.type === "obs-not-used" ? null : state.interrupted),
    };
  }

  if (
    !following(state) &&
    next.obs.type === "obs-recording" &&
    action.type === "recording-started"
  )
    exec({
      type: "start-session",
      outputPath: next.obs.latestOutputPath,
      silenceLength: action.silenceLength,
      silenceThresholdDb: next.obs.silenceThresholdDb,
    });
  else if (following(state) && !following(next)) exec({ type: "stop-session" });
  return next;
};

export const innerToOuterState = (
  state: OBSConnectionInnerState
): OBSConnectionOuterState => {
  if (
    state.type === "checking-obs-connection-status" ||
    state.type === "obs-not-used"
  ) {
    return { type: "obs-not-running" };
  }

  return state;
};
