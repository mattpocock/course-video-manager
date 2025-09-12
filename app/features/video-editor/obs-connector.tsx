import { useEffect, useState, useRef, useCallback } from "react";
import { OBSWebSocket } from "obs-websocket-js";
import { useFetcher } from "react-router";
import { Button } from "@/components/ui/button";
import { CheckIcon, Loader2, Mic, MicIcon } from "lucide-react";

export type OBSConnectionState =
  | {
      type: "obs-not-running";
    }
  | {
      type: "checking-obs-connection-status";
    }
  | {
      type: "obs-connected";
    }
  | {
      type: "obs-recording";
    }
  | {
      type: "importing-video";
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
  connected: boolean;
  websocket: OBSWebSocket;
}) => {
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  const cleanupMediaStream = useCallback(() => {
    mediaStream?.getTracks().forEach((track) => track.stop());
    setMediaStream(null);
  }, [mediaStream]);

  // Manage virtualCameraState
  useEffect(() => {
    if (!props.connected) {
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
        audio: false,
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
          video: { deviceId: obsVirtualcamDevice.deviceId },
        });

        setMediaStream(obsStream);
      }
    })();

    return () => {
      unmounted = true;
    };
  }, [props.connected, props.websocket]);

  return mediaStream;
};

export const useOBSConnector = (props: {
  videoId: string;
  onImportComplete: () => void;
}) => {
  const appendFromOBSFetcher = useFetcher();

  const [websocket] = useState(() => new OBSWebSocket());

  const [state, setState] = useState<OBSConnectionState>({
    type: "checking-obs-connection-status",
  });

  const onRecordingComplete = useCallback(() => {
    setState({ type: "importing-video" });
    appendFromOBSFetcher
      .submit(null, {
        method: "POST",
        action: `/videos/${props.videoId}/append-from-obs`,
      })
      .then(() => {
        setState({ type: "obs-connected" });
        props.onImportComplete();
      })
      .catch((e) => {
        throw e;
      });
  }, [appendFromOBSFetcher, props.videoId, props.onImportComplete]);

  useEffect(() => {
    if (state.type === "checking-obs-connection-status") {
      websocket
        .connect("ws://192.168.1.55:4455")
        .then(() => {
          setState({ type: "obs-connected" });
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
    if (state.type === "obs-connected" || state.type === "obs-recording") {
      createNotRunningListener(websocket, () => {
        setState({ type: "obs-not-running" });
      });

      const recordingListener = (e: {
        outputActive: boolean;
        outputState: string;
        outputPath: string;
      }) => {
        if (e.outputState === "OBS_WEBSOCKET_OUTPUT_STARTED") {
          setState({ type: "obs-recording" });
        } else if (e.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED") {
          setState({ type: "importing-video" });
          onRecordingComplete();
        }
      };

      websocket.on("RecordStateChanged", recordingListener);
      return () => {
        websocket.removeAllListeners();
      };
    }
  }, [state]);

  const mediaStream = useConnectToOBSVirtualCamera({
    connected:
      state.type === "obs-connected" ||
      state.type === "obs-recording" ||
      state.type === "importing-video",
    websocket,
  });

  return {
    state,
    mediaStream,
    manuallyAppendFromOBS: () => {
      setState({ type: "importing-video" });
      onRecordingComplete();
    },
  };
};

export const OBSConnectionButton = (props: {
  state: OBSConnectionState;
  manuallyAppendFromOBS: () => void;
}) => {
  return (
    <Button variant="ghost" onClick={props.manuallyAppendFromOBS}>
      {(props.state.type === "checking-obs-connection-status" ||
        props.state.type === "obs-not-running") && (
        <>
          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          Connecting to OBS...
        </>
      )}
      {props.state.type === "obs-connected" && (
        <>
          <CheckIcon className="w-4 h-4 mr-1" />
          OBS Ready
        </>
      )}
      {props.state.type === "obs-recording" && (
        <>
          <MicIcon className="w-4 h-4 mr-1" />
          Recording...
        </>
      )}
      {props.state.type === "importing-video" && (
        <>
          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
          Appending...
        </>
      )}
    </Button>
  );
};
