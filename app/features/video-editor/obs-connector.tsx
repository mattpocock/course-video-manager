import { OBSWebSocket } from "obs-websocket-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useEffectReducer, type EffectReducer } from "use-effect-reducer";
import {
  useSpeechDetector,
  useWatchForSilenceDetected,
  useWatchForSpeechDetected,
} from "./use-speech-detector";
import type { SilenceLength } from "@/silence-detection-constants";

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
};

export type OBSRecordingState = {
  type: "obs-recording";
  profile: string;
  scene: string;
  latestOutputPath: string;
};

export type OBSConnectionOuterState =
  | OBSNotRunningState
  | OBSConnectedState
  | OBSRecordingState;

export type OBSConnectionInnerState =
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
}) => {
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const cleanupMediaStream = useCallback(() => {
    mediaStream?.getTracks().forEach((track) => track.stop());
    setMediaStream(null);
  }, [mediaStream]);

  const shouldShowMediaStream =
    props.state.type === "obs-connected" ||
    props.state.type === "obs-recording";

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

      if (obsVirtualcamDevice) {
        while (!unmounted) {
          try {
            const obsStream = await navigator.mediaDevices.getUserMedia({
              video: {
                deviceId: obsVirtualcamDevice.deviceId,
                width: 1280,
              },
              audio: true,
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
      }
    | {
        type: "recording-stopped";
        outputPath: string;
      }
    | {
        type: "scene-changed";
        scene: string;
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
      };
}

const obsConnectorReducer: EffectReducer<
  useOBSConnector.State,
  useOBSConnector.Action,
  useOBSConnector.Effect
> = (state, action, exec): useOBSConnector.State => {
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
        return {
          type: "obs-recording",
          profile: state.profile,
          scene: state.scene,
          latestOutputPath: action.outputPath,
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
  if (state.type === "checking-obs-connection-status") {
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
}) => {
  const [websocket] = useState(() => new OBSWebSocket());

  const [state] = useEffectReducer(
    obsConnectorReducer,
    (exec) => {
      exec({
        type: "attempt-to-connect",
      });
      return {
        type: "checking-obs-connection-status" as const,
      };
    },
    {
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
          .connect("ws://localhost:4455")
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

  const outerState = useMemo(() => innerToOuterState(state), [state]);

  const mediaStream = useConnectToOBSVirtualCamera({
    state: outerState,
    websocket,
  });

  const speechDetectorState = useSpeechDetector({
    mediaStream,
    isRecording: state.type === "obs-recording",
    silenceLength: props.silenceLength,
  });

  useWatchForSpeechDetected({
    state: speechDetectorState,
    onSpeechPartStarted: (soundDetectionId) => {
      if (state.type === "obs-recording") {
        props.onNewClipOptimisticallyAdded({
          scene: state.scene,
          profile: state.profile,
          soundDetectionId,
        });
      }
    },
  });

  useWatchForSilenceDetected({
    state: speechDetectorState,
    onSilenceDetected: () => {
      if (state.type === "obs-recording") {
        props.onClipAudioWindowClosed();
      }
    },
  });

  const output = useMemo(() => {
    return {
      state: outerState,
      mediaStream,
      speechDetectorState,
    };
  }, [JSON.stringify(outerState), mediaStream, speechDetectorState]);

  return output;
};
