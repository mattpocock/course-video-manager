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
      profile: string;
    }
  | {
      type: "obs-recording";
      profile: string;
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
      props.state.type !== "obs-recording"
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
  }, [props.state, props.websocket]);

  return mediaStream;
};

export const useOBSImportQueue = (props: {
  videoId: string;
  onImportComplete: () => void;
}) => {
  const [importQueue, setImportQueue] = useState<string[]>([]);
  const [importState, setImportState] = useState<"importing" | "idle">("idle");
  const appendFromOBSFetcher = useFetcher();

  const addToImportQueue = (filePath: string) => {
    setImportQueue((prev) => [...prev, filePath]);
  };

  useEffect(() => {
    if (importState === "importing") return;
    if (importQueue.length === 0) return;

    setImportState("importing");

    const filePath = importQueue[0];

    if (filePath) {
      appendFromOBSFetcher
        .submit(
          { filePath },
          {
            action: `/videos/${props.videoId}/append-from-obs`,
            method: "POST",
            encType: "application/json",
          }
        )
        .then(() => {
          setImportState("idle");
          setImportQueue((prev) => prev.slice(1));
          props.onImportComplete();
        });
    }
  }, [
    importState,
    importQueue,
    appendFromOBSFetcher,
    props.videoId,
    props.onImportComplete,
  ]);

  return {
    isImporting: importQueue.length > 0,
    addToImportQueue,
  };
};

export const useOBSConnector = (props: {
  videoId: string;
  onImportComplete: () => void;
}) => {
  const [websocket] = useState(() => new OBSWebSocket());

  const [state, setState] = useState<OBSConnectionState>({
    type: "checking-obs-connection-status",
  });

  const { isImporting, addToImportQueue } = useOBSImportQueue({
    videoId: props.videoId,
    onImportComplete: props.onImportComplete,
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
          });
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
          setState({ type: "obs-recording", profile: state.profile });
        } else if (e.outputState === "OBS_WEBSOCKET_OUTPUT_STOPPED") {
          setState({ type: "obs-connected", profile: state.profile });
          addToImportQueue(e.outputPath);
        }
      };

      websocket.on("RecordStateChanged", recordingListener);

      const currentProfileChangedListener = (e: { profileName: string }) => {
        console.log("currentProfileChangedListener", e.profileName);
        setState({ type: state.type, profile: e.profileName });
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

  return {
    state,
    mediaStream,
    isImporting,
  };
};

export const OBSConnectionButton = (props: {
  state: OBSConnectionState;
  isImporting: boolean;
}) => {
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
      {props.state.type === "obs-connected" && (
        <>
          {props.isImporting ? (
            <>
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              Appending...
            </>
          ) : (
            <>
              <CheckIcon className="w-4 h-4 mr-1" />
              OBS Ready
            </>
          )}
        </>
      )}
    </Button>
  );
};
