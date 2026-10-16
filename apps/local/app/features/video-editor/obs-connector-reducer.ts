import type { EffectReducer } from "use-effect-reducer";
import type { SilenceLength } from "@/silence-detection-constants";
import {
  calibrationValidity,
  RECORDER_CAMERA_NAME,
  describeCalibrationRefusal,
  type LastPassedCalibration,
} from "@/av-calibration-constants";
import type { speechDetectorReducer } from "./speech-detector-reducer";
import {
  createInitialRecorderSessionState,
  recorderSessionReducer,
} from "./recorder-session-reducer";

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
 * and the browser's speech detector on the mic. The Recording Session
 * followed, its speech, Attaching, the gate's decision and the clip effects
 * are the shared `recorderSessionReducer` (ADR 0050), as for the CVM
 * recorder: this reducer turns OBS's websocket events and the silence scan
 * into its events, and keeps the connection.
 *
 * OBS names a recording only by its file, which a later one may reuse, so
 * the Recording Session followed is named by its file and when it started.
 * A connect that finds OBS recording cannot say which take that is: the one
 * followed re-attaches (#2198); any other is stopped.
 */
export namespace obsConnectorReducer {
  /** The Recording Session followed is the shared reducer's. */
  export type State = recorderSessionReducer.State & {
    obs: OBSConnectionInnerState;
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
    | { type: "log-unexpected"; message: string }
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
  const session = createInitialRecorderSessionState();
  if (!usesObs)
    return { ...session, obs: { type: "obs-not-used" }, interrupted: null };
  exec({ type: "attempt-to-connect" });
  return {
    ...session,
    obs: { type: "checking-obs-connection-status" },
    interrupted: null,
  };
};

/** The connection alone: what OBS reports of it. */
const connection = (
  state: OBSConnectionInnerState,
  action: Exclude<
    obsConnectorReducer.Action,
    { type: "speech-heard" | "recording-started" | "recording-stopped" }
  >,
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
    case "profile-changed":
      if (state.type === "obs-recording" || state.type === "obs-connected")
        return { ...state, profile: action.profile };
      exec({
        type: "log-unexpected",
        message: `OBS: profile changed while ${state.type}`,
      });
      return state;
    case "scene-changed":
      if (state.type === "obs-recording" || state.type === "obs-connected")
        return { ...state, scene: action.scene };
      exec({
        type: "log-unexpected",
        message: `OBS: scene changed while ${state.type}`,
      });
      return state;
  }
};

/** The recording OBS makes for the Recording Session followed. */
const recordingFollowed = (state: obsConnectorReducer.State) =>
  state.obs.type === "obs-recording" ? state.obs : state.interrupted;

/** The shared reducer's effects, as OBS's runner takes them. */
const obsExec =
  (
    state: obsConnectorReducer.State,
    exec: Exec,
    started?: { outputPath: string; silenceThresholdDb: number }
  ) =>
  (effect: recorderSessionReducer.Effect) => {
    switch (effect.type) {
      case "start-session":
        if (started)
          exec({
            type: "start-session",
            outputPath: started.outputPath,
            silenceLength: effect.silenceLength,
            silenceThresholdDb: started.silenceThresholdDb,
          });
        return;
      case "start-take": {
        const recording = recordingFollowed(state);
        if (recording)
          exec({
            type: "start-take",
            scene: recording.scene,
            profile: recording.profile,
            soundDetectionId: effect.soundDetectionId,
          });
        return;
      }
      case "stop-recording":
      case "stop-session":
      case "close-take-window":
      case "log-unexpected":
        exec(effect);
    }
  };

/**
 * A connect: the recording followed when the websocket dropped re-attaches
 * if OBS still records, and ends if not. A connect with none followed stops
 * any recording OBS is making (Attaching).
 */
const connected = (
  state: obsConnectorReducer.State,
  action: Extract<obsConnectorReducer.Action, { type: "obs-connected" }>,
  exec: Exec
): obsConnectorReducer.State => {
  const obs = connection(state.obs, action, exec);
  if (obs.type !== "obs-connected") return { ...state, obs };
  const followed = recordingFollowed(state);
  const session = recorderSessionReducer(
    state,
    {
      type: "recorder-reported",
      reachable: true,
      recording: action.recording,
      recordingSessionId: null,
      // Unused: OBS never follows a recording it did not see start.
      silenceLength: "short",
    },
    obsExec(state, exec)
  );
  if (followed && session.recordingSessionId !== null)
    return {
      ...session,
      obs: { ...followed, profile: obs.profile, scene: obs.scene },
      interrupted: null,
    };
  return {
    ...session,
    obs: followed
      ? { ...obs, latestOutputPath: followed.latestOutputPath }
      : obs,
    interrupted: null,
  };
};

/** OBS started recording: the gate decides (ADR 0038), then it is followed. */
const recordingStarted = (
  state: obsConnectorReducer.State,
  action: Extract<obsConnectorReducer.Action, { type: "recording-started" }>,
  exec: Exec
): obsConnectorReducer.State => {
  if (state.obs.type !== "obs-connected") {
    exec({
      type: "log-unexpected",
      message: `OBS: recording started while ${state.obs.type}`,
    });
    return state;
  }
  // THE GATE (ADR 0038): a take OBS started without a fresh AV Calibration
  // on this camera + mic pair is stopped at once, and the editor says why.
  // OBS cannot say which camera it records: the recorder service's is taken
  // as it. Only here, at its start: a take let through runs to its end.
  const gate = calibrationValidity(
    action.lastPassed,
    {
      browserInputLabel: action.browserInputLabel,
      camera: RECORDER_CAMERA_NAME,
    },
    action.nowMs
  );
  const started = {
    type: "recording-started",
    recordingSessionId: `${action.outputPath}@${action.nowMs}`,
    silenceLength: action.silenceLength,
  } as const;
  if (!gate.valid)
    return {
      ...recorderSessionReducer(
        state,
        { ...started, refused: true },
        obsExec(state, exec)
      ),
      obs: {
        ...state.obs,
        calibrationRefusal: describeCalibrationRefusal(gate.reason),
      },
    };
  const silenceThresholdDb = gate.calibration.thresholdDb;
  const session = recorderSessionReducer(
    state,
    { ...started, refused: false },
    obsExec(state, exec, { outputPath: action.outputPath, silenceThresholdDb })
  );
  if (session.recordingSessionId === null) return session;
  return {
    ...session,
    obs: {
      type: "obs-recording",
      profile: state.obs.profile,
      scene: state.obs.scene,
      latestOutputPath: action.outputPath,
      silenceThresholdDb,
    },
  };
};

const recordingStopped = (
  state: obsConnectorReducer.State,
  action: Extract<obsConnectorReducer.Action, { type: "recording-stopped" }>,
  exec: Exec
): obsConnectorReducer.State => {
  const obs = state.obs;
  if (obs.type === "obs-connected")
    // One OBS was asked to stop (the gate, Attaching): never followed.
    return { ...state, obs: { ...obs, latestOutputPath: action.outputPath } };
  if (obs.type !== "obs-recording" || state.recordingSessionId === null) {
    exec({
      type: "log-unexpected",
      message: `OBS: recording stopped while ${obs.type}`,
    });
    return state;
  }
  return {
    ...recorderSessionReducer(
      state,
      {
        type: "recording-stopped",
        recordingSessionId: state.recordingSessionId,
      },
      obsExec(state, exec)
    ),
    obs: {
      type: "obs-connected",
      profile: obs.profile,
      scene: obs.scene,
      latestOutputPath: action.outputPath,
    },
  };
};

export const obsConnectorReducer: EffectReducer<
  obsConnectorReducer.State,
  obsConnectorReducer.Action,
  obsConnectorReducer.Effect
> = (state, action, exec) => {
  // A CVM recorder Video ignores whatever OBS still reports.
  if (state.obs.type === "obs-not-used" && action.type !== "obs-connected") {
    if (action.type !== "video-recorder-changed" || !action.usesObs)
      return state;
  }
  switch (action.type) {
    case "speech-heard":
      return recorderSessionReducer(
        state,
        {
          type: "speech-heard",
          recordingSessionId: state.recordingSessionId,
          heard: action.heard,
        },
        obsExec(state, exec)
      );
    case "obs-connected":
      return connected(state, action, exec);
    case "recording-started":
      return recordingStarted(state, action, exec);
    case "recording-stopped":
      return recordingStopped(state, action, exec);
    case "video-recorder-changed": {
      const obs = connection(state.obs, action, exec);
      if (obs.type !== "obs-not-used") return { ...state, obs };
      return {
        ...recorderSessionReducer(
          state,
          { type: "recorder-released" },
          obsExec(state, exec)
        ),
        obs,
        interrupted: null,
      };
    }
    case "connection-closed":
      // The websocket dropped mid-take: OBS records on, and so does the take.
      return {
        ...state,
        obs: connection(state.obs, action, exec),
        interrupted:
          state.obs.type === "obs-recording" ? state.obs : state.interrupted,
      };
    case "obs-connection-failed":
    case "trigger-reconnect":
    case "profile-changed":
    case "scene-changed":
      return { ...state, obs: connection(state.obs, action, exec) };
  }
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
