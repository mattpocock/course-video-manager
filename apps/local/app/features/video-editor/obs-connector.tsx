import { OBS_WEBSOCKET_URL } from "@/lib/live-channels";
import { OBSWebSocket } from "obs-websocket-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEffectReducer } from "use-effect-reducer";
import { useSpeechDetector } from "./use-speech-detector";
import {
  DEFAULT_SILENCE_THRESHOLD_DB,
  type SilenceLength,
} from "@/silence-detection-constants";
import type { LastPassedCalibration } from "@/av-calibration-constants";
import { isMicDevice, MIC_NAME } from "@/mic-device";
import { ensureOBSProfile } from "./ensure-obs-profile";
import { useEnsureOBSProfile } from "./use-ensure-obs-profile";
import type { ClipReducerAction } from "./clip-state-reducer.types";
import {
  createInitialOBSConnectorState,
  innerToOuterState,
  obsConnectorReducer,
  type OBSConnectionOuterState,
} from "./obs-connector-reducer";
import { toFrontendSpeechDetectorState } from "./speech-detector-reducer";

export type {
  OBSConnectedState,
  OBSConnectionInnerState,
  OBSConnectionOuterState,
  OBSNotRunningState,
  OBSRecordingState,
} from "./obs-connector-reducer";

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

/**
 * The effect runner for `obsConnectorReducer`, and the bridge from OBS's
 * websocket and the mic's silence scan into it. Its clip effects reach the
 * clip reducer as the CVM recorder's do (`use-cvm-recorder.ts`).
 */
export const useOBSConnector = (props: {
  clipDispatch: (action: ClipReducerAction) => void;
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
    silenceLength: props.silenceLength,
  });
  // A reconnect runs the listeners again: the old ones go first.
  const stopListeningRef = useRef<(() => void) | null>(null);

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
            const record = await websocket.call("GetRecordStatus");

            dispatch({
              type: "obs-connected",
              profile: profile.currentProfileName,
              scene: scene.currentProgramSceneName,
              recording: record.outputActive,
            });
          })
          .catch((e) => {
            console.error(e);
            dispatch({ type: "obs-connection-failed", error: e });
          });
      },
      "run-event-listeners": (_state, _effect, dispatch) => {
        stopListeningRef.current?.();
        const stopNotRunning = createNotRunningListener(websocket, () => {
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

        const stopListening = () => {
          stopNotRunning();
          websocket.removeListener("RecordStateChanged", recordingListener);
          websocket.removeListener(
            "CurrentProfileChanged",
            currentProfileChangedListener
          );
          websocket.removeListener(
            "CurrentProgramSceneChanged",
            currentSceneChangedListener
          );
          if (stopListeningRef.current === stopListening)
            stopListeningRef.current = null;
        };
        stopListeningRef.current = stopListening;
        return stopListening;
      },
      "start-session": (_state, effect) => {
        props.clipDispatch({
          type: "recording-started",
          outputPath: effect.outputPath,
          silenceLength: effect.silenceLength,
          silenceThresholdDb: effect.silenceThresholdDb,
        });
      },
      "stop-session": () => {
        props.clipDispatch({ type: "recording-stopped" });
      },
      "start-take": (_state, { type: _, ...take }) => {
        props.onNewClipOptimisticallyAdded(take);
      },
      "close-take-window": () => {
        props.onClipAudioWindowClosed();
      },
    }
  );

  // Bridges the Video's Recorder choice into the connector.
  useEffect(() => {
    dispatch({ type: "video-recorder-changed", usesObs: props.usesObs });
  }, [props.usesObs]);

  const obs = state.obs;
  const outerState = useMemo(() => innerToOuterState(obs), [obs]);

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
    silenceLength: props.silenceLength,
  };

  useSpeechDetector({
    mediaStream,
    isRecording: obs.type === "obs-recording",
    speech: state.speech,
    silenceLength: props.silenceLength,
    thresholdDb:
      obs.type === "obs-recording"
        ? obs.silenceThresholdDb
        : (props.lastPassedCalibration?.thresholdDb ??
          DEFAULT_SILENCE_THRESHOLD_DB),
    onHeard: (heard) => dispatch({ type: "speech-heard", heard }),
  });
  const speechDetectorState = useMemo(
    () => toFrontendSpeechDetectorState(state.speech),
    [state.speech]
  );

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
