import { OBS_WEBSOCKET_URL } from "@/lib/live-channels";
import { OBSWebSocket } from "obs-websocket-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEffectReducer, type EffectReducer } from "use-effect-reducer";
import { useSpeechDetector } from "./use-speech-detector";
import { obsTakeSignal } from "./obs-clip-bridge";
import {
  DEFAULT_SILENCE_THRESHOLD_DB,
  type SilenceLength,
} from "@/silence-detection-constants";
import {
  calibrationValidity,
  RECORDER_CAMERA_NAME,
  describeCalibrationRefusal,
  type LastPassedCalibration,
} from "@/av-calibration-constants";
import { isMicDevice, MIC_NAME } from "@/mic-device";
import { ensureOBSProfile } from "./ensure-obs-profile";
import { useEnsureOBSProfile } from "./use-ensure-obs-profile";

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

const createNotRunningListener = (
  websocket: OBSWebSocket,
  callback: () => void
) => {
  const notRunningListener = () => {
    callback();
  };

  websocket.on("ConnectionClosed", notRunningListener);

  return () => {
    websocket.removeListener("ConnectionClosed", notRunningListener);
  };
};

// Module-level timeout so navigating between edit pages can cancel a pending stop
let pendingStopTimeout: ReturnType<typeof setTimeout> | null = null;

export const useConnectToOBSVirtualCamera = (props: {
  state: OBSConnectionOuterState;
  websocket: OBSWebSocket;
  profileReady: boolean;
}) => {
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const cleanupMediaStream = useCallback(() => {
    mediaStream?.getTracks().forEach((track) => track.stop());
    setMediaStream(null);
  }, [mediaStream]);

  const shouldShowMediaStream =
    (props.state.type === "obs-connected" ||
      props.state.type === "obs-recording") &&
    props.profileReady;

  // Manage virtualCameraState
  useEffect(() => {
    // Cancel any pending stop from a previous instance (e.g., navigating between videos)
    if (pendingStopTimeout) {
      clearTimeout(pendingStopTimeout);
      pendingStopTimeout = null;
    }

    if (!shouldShowMediaStream) {
      cleanupMediaStream();

      return;
    }

    let unmounted = false;

    (async () => {
      try {
        await props.websocket.call("StartVirtualCam");
      } catch (e) {
        console.error("Error starting virtual cam", e);
      }

      if (unmounted) return;

      let stream: MediaStream | undefined;

      while (!unmounted) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });

          stream.getTracks().forEach((track) => track.stop());
          break;
        } catch (e) {
          console.error("Error getting initial media stream, retrying...", e);
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }

      if (unmounted || !stream) return;

      while (true) {
        const tracks = stream.getTracks();

        if (tracks.length === 0) {
          break;
        }

        if (tracks.every((track) => track.readyState === "ended")) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (unmounted) return;

      const devices = await navigator.mediaDevices.enumerateDevices();

      const obsVirtualcamDevice = devices.find(
        (device) =>
          device.kind === "videoinput" &&
          device.label.includes("OBS Virtual Camera")
      );

      if (unmounted) return;

      // The silence detector hears the Recorders' own mic, raw: Chrome's
      // processing off, every channel, so it measures as silencedetect does
      // on what the Recorders write (ADR 0034 §5).
      const micDevice = devices.find(
        (device) => device.kind === "audioinput" && isMicDevice(device.label)
      );
      if (!micDevice) {
        console.error(
          `${MIC_NAME} is not among the audio inputs, so no speech will be detected. Found: ${devices
            .filter((d) => d.kind === "audioinput")
            .map((d) => d.label)
            .join(", ")}`
        );
      }

      if (obsVirtualcamDevice) {
        while (!unmounted) {
          try {
            const obsStream = await navigator.mediaDevices.getUserMedia({
              video: {
                deviceId: obsVirtualcamDevice.deviceId,
                width: 1280,
              },
              audio: micDevice
                ? {
                    deviceId: { exact: micDevice.deviceId },
                    autoGainControl: false,
                    noiseSuppression: false,
                    echoCancellation: false,
                    channelCount: 2,
                  }
                : false,
            });

            setMediaStream(obsStream);
            break;
          } catch (e) {
            console.error(
              "Error connecting to OBS Virtual Camera, retrying...",
              e
            );
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }
    })();

    const stopVirtualCam = () => {
      props.websocket.call("StopVirtualCam").catch((e) => {
        console.error(e);
      });
    };

    // Stop immediately on tab/window close
    window.addEventListener("beforeunload", stopVirtualCam);

    return () => {
      unmounted = true;
      window.removeEventListener("beforeunload", stopVirtualCam);
      // Defer the stop so navigating to another edit page can cancel it
      pendingStopTimeout = setTimeout(() => {
        stopVirtualCam();
        pendingStopTimeout = null;
      }, 500);
    };
  }, [shouldShowMediaStream, props.websocket]);

  return mediaStream;
};

export namespace useOBSConnector {
  export type State = OBSConnectionInnerState;
  export type Action =
    | {
        type: "obs-connected";
        profile: string;
        scene: string;
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
      };

  export type Effect =
    | {
        type: "stop-recording";
      }
    | {
        type: "log-error";
        error: unknown;
      }
    | {
        type: "wait-before-reconnecting";
      }
    | {
        type: "stop-recording";
      }
    | {
        type: "attempt-to-connect";
      }
    | {
        type: "run-event-listeners";
      }
    | {
        type: "disconnect";
      };
}

/** OBS Videos connect at once, exactly as before the Recorder choice. */
export const createInitialOBSConnectorState = (
  usesObs: boolean,
  exec: (effect: useOBSConnector.Effect) => void
): useOBSConnector.State => {
  if (!usesObs) return { type: "obs-not-used" };
  exec({ type: "attempt-to-connect" });
  return { type: "checking-obs-connection-status" };
};

export const obsConnectorReducer: EffectReducer<
  useOBSConnector.State,
  useOBSConnector.Action,
  useOBSConnector.Effect
> = (state, action, exec): useOBSConnector.State => {
  if (action.type === "video-recorder-changed") {
    if (action.usesObs) {
      return state.type === "obs-not-used"
        ? createInitialOBSConnectorState(true, exec)
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
      exec({
        type: "stop-recording",
      });
      exec({
        type: "run-event-listeners",
      });
      return {
        type: "obs-connected",
        profile: action.profile,
        scene: action.scene,
        latestOutputPath: null,
      };
    case "obs-connection-failed":
      exec({
        type: "log-error",
        error: action.error,
      });
      exec({
        type: "wait-before-reconnecting",
      });
      return {
        type: "obs-not-running",
      };
    case "trigger-reconnect":
      exec({
        type: "attempt-to-connect",
      });
      return {
        type: "checking-obs-connection-status",
      };
    case "connection-closed":
      exec({
        type: "attempt-to-connect",
      });
      return {
        type: "obs-not-running",
      };
    case "profile-changed": {
      if (state.type === "obs-recording" || state.type === "obs-connected") {
        return {
          ...state,
          profile: action.profile,
        };
      }

      throw new Error("Profile changed but not recording or connected");
    }
    case "scene-changed": {
      if (state.type === "obs-recording" || state.type === "obs-connected") {
        return {
          ...state,
          scene: action.scene,
        };
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
        return {
          ...state,
          latestOutputPath: action.outputPath,
        };
      }

      throw new Error("Obs stopped recording but not recording or connected");
    }
  }
};

const innerToOuterState = (
  state: OBSConnectionInnerState
): OBSConnectionOuterState => {
  if (
    state.type === "checking-obs-connection-status" ||
    state.type === "obs-not-used"
  ) {
    return {
      type: "obs-not-running",
    };
  }

  return state;
};

export const useOBSConnector = (props: {
  onNewClipOptimisticallyAdded: (opts: {
    scene: string;
    profile: string;
    soundDetectionId: string;
  }) => void;
  onClipAudioWindowClosed: () => void;
  silenceLength: SilenceLength;
  /**
   * The latest AV Calibration passed under today's rules: a take OBS
   * starts is let through only under it (ADR 0038), and cuts with its
   * threshold.
   */
  lastPassedCalibration: LastPassedCalibration | null;
  targetProfile: string;
  /** False for a CVM recorder Video: OBS is left alone. */
  usesObs: boolean;
}) => {
  const [websocket] = useState(() => new OBSWebSocket());
  // Read by OBS's recording listener, which outlives a render.
  const gateFactsRef = useRef({
    lastPassed: props.lastPassedCalibration,
    browserInputLabel: null as string | null,
  });

  const [state, dispatch] = useEffectReducer(
    obsConnectorReducer,
    (exec) => createInitialOBSConnectorState(props.usesObs, exec),
    {
      disconnect: () => {
        websocket
          .call("StopVirtualCam")
          .catch(() => {})
          .finally(() => websocket.disconnect());
      },
      "wait-before-reconnecting": (_state, _effect, dispatch) => {
        const timeout = setTimeout(() => {
          dispatch({ type: "trigger-reconnect" });
        }, 1000);

        return () => {
          clearTimeout(timeout);
        };
      },
      "stop-recording": (_state, _effect, _dispatch) => {
        websocket.call("StopRecord").catch((e) => {
          console.error(e);
        });
      },
      "log-error": (_state, effect, _dispatch) => {
        console.error(effect.error);
      },
      "attempt-to-connect": (_state, _effect, dispatch) => {
        console.log("Attempting to reconnect");
        websocket
          .connect(OBS_WEBSOCKET_URL)
          .then(async () => {
            const profile = await websocket.call("GetProfileList");
            const scene = await websocket.call("GetSceneList");

            dispatch({
              type: "obs-connected",
              profile: profile.currentProfileName,
              scene: scene.currentProgramSceneName,
            });
          })
          .catch((e) => {
            console.error(e);
            dispatch({ type: "obs-connection-failed", error: e });
          });
      },
      "run-event-listeners": (_state, _effect, dispatch) => {
        createNotRunningListener(websocket, () => {
          dispatch({ type: "connection-closed" });
        });

        const recordingListener = (e: {
          outputActive: boolean;
          outputState: string;
          outputPath: string;
        }) => {
          if (e.outputState === "OBS_WEBSOCKET_OUTPUT_STARTED") {
            dispatch({
              type: "recording-started",
              outputPath: e.outputPath,
              ...gateFactsRef.current,
              nowMs: Date.now(),
            });
          } else if (e.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED") {
            dispatch({
              type: "recording-stopped",
              outputPath: e.outputPath,
            });
          }
        };

        websocket.on("RecordStateChanged", recordingListener);

        const currentProfileChangedListener = (e: { profileName: string }) => {
          dispatch({
            type: "profile-changed",
            profile: e.profileName,
          });
        };

        websocket.on("CurrentProfileChanged", currentProfileChangedListener);

        const currentSceneChangedListener = (e: { sceneName: string }) => {
          dispatch({
            type: "scene-changed",
            scene: e.sceneName,
          });
        };

        websocket.on("CurrentProgramSceneChanged", currentSceneChangedListener);

        return () => {
          websocket.removeListener("RecordStateChanged", recordingListener);
          websocket.removeListener(
            "CurrentProfileChanged",
            currentProfileChangedListener
          );
          websocket.removeListener(
            "CurrentProgramSceneChanged",
            currentSceneChangedListener
          );
        };
      },
    }
  );

  // Bridges the Video's Recorder choice into the connector.
  useEffect(() => {
    dispatch({ type: "video-recorder-changed", usesObs: props.usesObs });
  }, [props.usesObs]);

  const outerState = useMemo(() => innerToOuterState(state), [state]);

  const ensureProfileFn = useCallback(
    (targetProfile: string) => ensureOBSProfile(websocket, targetProfile),
    [websocket]
  );

  const { profileReady } = useEnsureOBSProfile({
    obsState: outerState,
    targetProfile: props.targetProfile,
    ensureProfile: ensureProfileFn,
    onError: (message) => console.error("[OBS profile switch]", message),
  });

  const mediaStream = useConnectToOBSVirtualCamera({
    state: outerState,
    websocket,
    profileReady,
  });

  /** The mic the browser detector hears: what the gate compares on OBS. */
  const browserInputLabel = mediaStream?.getAudioTracks()[0]?.label ?? null;
  gateFactsRef.current = {
    lastPassed: props.lastPassedCalibration,
    browserInputLabel,
  };

  const speechDetectorState = useSpeechDetector({
    mediaStream,
    isRecording: state.type === "obs-recording",
    silenceLength: props.silenceLength,
    thresholdDb:
      state.type === "obs-recording"
        ? state.silenceThresholdDb
        : (props.lastPassedCalibration?.thresholdDb ??
          DEFAULT_SILENCE_THRESHOLD_DB),
  });

  // Bridges the speech detector's Takes to the editor (`obs-clip-bridge.ts`).
  const prevSpeechDetectorStateRef = useRef(speechDetectorState);
  useEffect(() => {
    const signal = obsTakeSignal(
      prevSpeechDetectorStateRef.current,
      speechDetectorState,
      state
    );
    prevSpeechDetectorStateRef.current = speechDetectorState;
    if (signal?.type === "take-started") {
      const { type: _, ...take } = signal;
      props.onNewClipOptimisticallyAdded(take);
    } else if (signal?.type === "take-window-closed") {
      props.onClipAudioWindowClosed();
    }
  }, [speechDetectorState]);

  const output = useMemo(() => {
    return {
      state: outerState,
      mediaStream,
      browserInputLabel,
      speechDetectorState,
    };
  }, [
    JSON.stringify(outerState),
    mediaStream,
    browserInputLabel,
    speechDetectorState,
  ]);

  return output;
};
