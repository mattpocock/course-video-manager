import type { DB } from "@/db/schema";
import { OBSWebSocket } from "obs-websocket-js";
import { useCallback, useEffect, useState } from "react";
import {
  useSpeechDetector,
  useWatchForSpeechDetected,
} from "./use-speech-detector";
import { useEffectReducer, type EffectReducer } from "use-effect-reducer";

export type OBSConnectionState =
  | {
      type: "obs-not-running";
    }
  | {
      type: "checking-obs-connection-status";
    }
  | {
      type: "obs-connected";
      profile: string;
      scene: string;
      latestOutputPath: string | null;
    }
  | {
      type: "obs-recording";
      profile: string;
      scene: string;
      latestOutputPath: string;
      hasSpeechBeenDetected: boolean;
    };

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

export const useConnectToOBSVirtualCamera = (props: {
  state: OBSConnectionState;
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
            console.error("Error connecting to OBS Virtual Camera, retrying...", e);
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }
      }
    })();

    const onBeforeUnload = () => {
      props.websocket.call("StopVirtualCam").catch((e) => {
        console.error(e);
      });
    };

    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      unmounted = true;
      onBeforeUnload();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [shouldShowMediaStream, props.websocket]);

  return mediaStream;
};

export const useRunOBSImportRepeatedly = (props: {
  videoId: string;
  state:
    | {
        type: "should-run";
        filePath: string;
      }
    | {
        type: "should-not-run";
      };
  onNewDatabaseClips: (clips: DB.Clip[]) => void;
}) => {
  useEffect(() => {
    if (props.state.type === "should-run") {
      let unmounted = false;
      const filePath = props.state.filePath;

      (async () => {
        while (!unmounted) {
          await fetch(`/videos/${props.videoId}/append-from-obs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filePath }),
          }).then(async (res) => {
            if (res.ok) {
              const clips: DB.Clip[] = await res.json();
              if (clips.length > 0) {
                props.onNewDatabaseClips(clips);
              }
            }
          });
        }
      })();

      return () => {
        unmounted = true;
      };
    }
  }, [JSON.stringify(props.state)]);
};

export namespace useOBSConnector {
  export type State = OBSConnectionState;
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
        type: "speech-detected";
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
          hasSpeechBeenDetected: false,
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
    case "speech-detected": {
      if (state.type === "obs-recording") {
        return {
          ...state,
          hasSpeechBeenDetected: true,
        };
      }

      throw new Error("Speech detected but not recording");
    }
  }
};

export const useOBSConnector = (props: {
  videoId: string;
  onNewDatabaseClips: (clips: DB.Clip[]) => void;
  onNewClipOptimisticallyAdded: (opts: {
    scene: string;
    profile: string;
  }) => void;
}) => {
  const [websocket] = useState(() => new OBSWebSocket());

  const [state, dispatch] = useEffectReducer(
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

  console.log("state", state);

  useRunOBSImportRepeatedly({
    videoId: props.videoId,
    state:
      state.type === "obs-recording" && state.hasSpeechBeenDetected
        ? {
            type: "should-run",
            filePath: state.latestOutputPath,
          }
        : {
            type: "should-not-run",
          },
    onNewDatabaseClips: props.onNewDatabaseClips,
  });

  const mediaStream = useConnectToOBSVirtualCamera({
    state,
    websocket,
  });

  const speechDetectorState = useSpeechDetector({
    mediaStream,
    isRecording: state.type === "obs-recording",
  });

  useWatchForSpeechDetected({
    state: speechDetectorState,
    onSpeechPartEnded: () => {
      if (state.type === "obs-recording" && !state.hasSpeechBeenDetected) {
        dispatch({
          type: "speech-detected",
        });
      }
    },
    onSpeechPartStarted: () => {
      if (state.type === "obs-recording") {
        props.onNewClipOptimisticallyAdded({
          scene: state.scene,
          profile: state.profile,
        });
      }
    },
  });

  return {
    state,
    mediaStream,
    speechDetectorState,
  };
};
