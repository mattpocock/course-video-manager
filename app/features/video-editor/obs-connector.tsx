import { Button } from "@/components/ui/button";
import type { DB } from "@/db/schema";
import { CheckIcon, Loader2, MicIcon, PauseIcon } from "lucide-react";
import { OBSWebSocket } from "obs-websocket-js";
import { useCallback, useEffect, useState } from "react";
import type { ClipOptimisticallyAdded } from "./clip-state-reducer";
import {
  useSpeechDetector,
  useWatchForSpeechDetected,
} from "./use-speech-detector";

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
      latestOutputPath: string | null;
    }
  | {
      type: "obs-paused";
      profile: string;
      latestOutputPath: string;
    }
  | {
      type: "obs-recording";
      profile: string;
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

  // Manage virtualCameraState
  useEffect(() => {
    if (
      props.state.type !== "obs-connected" &&
      props.state.type !== "obs-recording" &&
      props.state.type !== "obs-paused"
    ) {
      cleanupMediaStream();

      return;
    }

    let unmounted = false;

    (async () => {
      try {
        await props.websocket.call("StartVirtualCam");
      } catch (e) {
        console.error(e);
      }

      if (unmounted) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      stream.getTracks().forEach((track) => track.stop());

      if (unmounted) return;

      const devices = await navigator.mediaDevices.enumerateDevices();

      const obsVirtualcamDevice = devices.find(
        (device) =>
          device.kind === "videoinput" &&
          device.label.includes("OBS Virtual Camera")
      );

      if (unmounted) return;

      if (obsVirtualcamDevice) {
        const obsStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: obsVirtualcamDevice.deviceId,
            width: 1280,
          },
          audio: true,
        });

        setMediaStream(obsStream);
      }
    })();

    return () => {
      unmounted = true;
    };
  }, [props.state.type, props.websocket]);

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

export const useOBSConnector = (props: {
  videoId: string;
  onNewDatabaseClips: (clips: DB.Clip[]) => void;
  onNewClipOptimisticallyAdded: () => void;
}) => {
  const [websocket] = useState(() => new OBSWebSocket());

  const [state, setState] = useState<OBSConnectionState>({
    type: "checking-obs-connection-status",
  });

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

  useEffect(() => {
    if (state.type === "checking-obs-connection-status") {
      websocket
        .connect("ws://192.168.1.55:4455")
        .then(async () => {
          const profile = await websocket.call("GetProfileList");

          setState({
            type: "obs-connected",
            profile: profile.currentProfileName,
            latestOutputPath: null,
          });

          try {
            await websocket.call("StopRecord");
          } catch (e) {}
        })
        .catch((e) => {
          console.error(e);
          setState({ type: "obs-not-running" });
        });
    }
  }, [state]);

  useEffect(() => {
    if (state.type === "obs-not-running") {
      const timeout = setTimeout(() => {
        setState({ type: "checking-obs-connection-status" });
      }, 1000);

      return () => {
        clearTimeout(timeout);
      };
    }
  }, [state]);

  useEffect(() => {
    if (
      state.type === "obs-connected" ||
      state.type === "obs-recording" ||
      state.type === "obs-paused"
    ) {
      createNotRunningListener(websocket, () => {
        setState({ type: "obs-not-running" });
      });

      const recordingListener = (e: {
        outputActive: boolean;
        outputState: string;
        outputPath: string;
      }) => {
        if (
          e.outputState === "OBS_WEBSOCKET_OUTPUT_STARTED" ||
          e.outputState === "OBS_WEBSOCKET_OUTPUT_RESUMED"
        ) {
          setState({
            type: "obs-recording",
            profile: state.profile,
            latestOutputPath: e.outputPath,
            hasSpeechBeenDetected: false,
          });
        } else if (e.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED") {
          setState({
            type: "obs-connected",
            profile: state.profile,
            latestOutputPath: e.outputPath,
          });
        } else if (e.outputState === "OBS_WEBSOCKET_OUTPUT_PAUSED") {
          setState({
            type: "obs-paused",
            profile: state.profile,
            latestOutputPath: e.outputPath,
          });
        }
      };

      websocket.on("RecordStateChanged", recordingListener);

      const currentProfileChangedListener = (e: { profileName: string }) => {
        setState({
          ...state,
          profile: e.profileName,
        });
      };

      websocket.on("CurrentProfileChanged", currentProfileChangedListener);

      return () => {
        websocket.removeListener("RecordStateChanged", recordingListener);
        websocket.removeListener(
          "CurrentProfileChanged",
          currentProfileChangedListener
        );
      };
    }
  }, [state]);

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
        setState({
          ...state,
          hasSpeechBeenDetected: true,
        });
      }
    },
    onSpeechPartStarted: () => {
      if (state.type === "obs-recording") {
        props.onNewClipOptimisticallyAdded();
      }
    },
  });

  return {
    state,
    mediaStream,
    speechDetectorState,
  };
};

export const OBSConnectionButton = (props: { state: OBSConnectionState }) => {
  return (
    <Button variant="ghost">
      {(props.state.type === "checking-obs-connection-status" ||
        props.state.type === "obs-not-running") && (
        <>
          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          Connecting to OBS...
        </>
      )}

      {props.state.type === "obs-recording" && (
        <>
          <MicIcon className="w-4 h-4 mr-1" />
          Recording...
        </>
      )}
      {props.state.type === "obs-paused" && (
        <>
          <PauseIcon className="w-4 h-4 mr-1" />
          Paused
        </>
      )}
      {props.state.type === "obs-connected" && (
        <>
          <>
            <CheckIcon className="w-4 h-4 mr-1" />
            OBS Ready
          </>
        </>
      )}
    </Button>
  );
};
