import { useCallback, useEffect, useRef, useState } from "react";
import { OBSWebSocket } from "obs-websocket-js";
import { CameraIcon, RefreshCwIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type CaptureCameraModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (dataUrl: string) => void;
};

const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;

function useOBSCameraStream(active: boolean) {
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const websocketRef = useRef<OBSWebSocket | null>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    let unmounted = false;
    const websocket = new OBSWebSocket();
    websocketRef.current = websocket;

    (async () => {
      // Try to connect to OBS and start virtual camera
      try {
        await websocket.connect("ws://localhost:4455");
        await websocket.call("StartVirtualCam");
      } catch {
        // OBS might not be running or virtual cam already started — continue anyway
      }

      if (unmounted) return;

      // Get initial media permissions
      try {
        const initial = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        initial.getTracks().forEach((track) => track.stop());
      } catch {
        if (!unmounted) setError("Camera permission denied");
        return;
      }

      if (unmounted) return;

      // Wait for tracks to fully stop
      await new Promise((resolve) => setTimeout(resolve, 200));

      if (unmounted) return;

      // Find OBS Virtual Camera device
      const devices = await navigator.mediaDevices.enumerateDevices();
      const obsDevice = devices.find(
        (d) => d.kind === "videoinput" && d.label.includes("OBS Virtual Camera")
      );

      if (unmounted) return;

      const deviceConstraints: MediaStreamConstraints = {
        video: obsDevice
          ? {
              deviceId: obsDevice.deviceId,
              width: CAPTURE_WIDTH,
              height: CAPTURE_HEIGHT,
            }
          : {
              width: CAPTURE_WIDTH,
              height: CAPTURE_HEIGHT,
            },
        audio: false,
      };

      // Connect to the camera
      let retries = 0;
      while (!unmounted && retries < 10) {
        try {
          const stream =
            await navigator.mediaDevices.getUserMedia(deviceConstraints);
          if (!unmounted) {
            setMediaStream(stream);
            if (!obsDevice) {
              setError(
                "OBS Virtual Camera not found. Using default camera instead."
              );
            }
          } else {
            stream.getTracks().forEach((track) => track.stop());
          }
          return;
        } catch {
          retries++;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }

      if (!unmounted) {
        setError("Could not connect to camera");
      }
    })();

    return () => {
      unmounted = true;
      websocket.call("StopVirtualCam").catch(() => {});
      websocket.disconnect().catch(() => {});
      websocketRef.current = null;
    };
  }, [active]);

  // Cleanup stream when deactivated
  useEffect(() => {
    if (!active && mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      setMediaStream(null);
      setError(null);
    }
  }, [active, mediaStream]);

  return { mediaStream, error };
}

export function CaptureCameraModal({
  open,
  onOpenChange,
  onCapture,
}: CaptureCameraModalProps) {
  const { mediaStream, error } = useOBSCameraStream(open);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  // Wire media stream to video element
  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
      videoRef.current.play();
    }
  }, [mediaStream, capturedImage]);

  // Reset captured image when modal closes
  useEffect(() => {
    if (!open) {
      setCapturedImage(null);
    }
  }, [open]);

  const handleCapture = useCallback(() => {
    if (!videoRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Crop-to-cover: calculate source rect to fill 1280x720
    const video = videoRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const targetRatio = CAPTURE_WIDTH / CAPTURE_HEIGHT;
    const videoRatio = vw / vh;

    let sx = 0,
      sy = 0,
      sw = vw,
      sh = vh;

    if (videoRatio > targetRatio) {
      // Video is wider — crop sides
      sw = vh * targetRatio;
      sx = (vw - sw) / 2;
    } else {
      // Video is taller — crop top/bottom
      sh = vw / targetRatio;
      sy = (vh - sh) / 2;
    }

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
    setCapturedImage(canvas.toDataURL("image/png"));
  }, []);

  // Spacebar to capture photo
  useEffect(() => {
    if (!open || !mediaStream || capturedImage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        handleCapture();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, mediaStream, capturedImage, handleCapture]);

  const handleRetake = useCallback(() => {
    setCapturedImage(null);
  }, []);

  const handleUseThis = useCallback(() => {
    if (capturedImage) {
      onCapture(capturedImage);
      onOpenChange(false);
    }
  }, [capturedImage, onCapture, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Capture Photo</DialogTitle>
        </DialogHeader>

        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
          {capturedImage ? (
            <img
              src={capturedImage}
              alt="Captured frame"
              className="h-full w-full object-contain"
            />
          ) : mediaStream ? (
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              {error || "Connecting to camera..."}
            </div>
          )}
        </div>

        {error && mediaStream && (
          <p className="text-sm text-yellow-500">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          {capturedImage ? (
            <>
              <Button variant="outline" onClick={handleRetake}>
                <RefreshCwIcon />
                Retake
              </Button>
              <Button onClick={handleUseThis}>Use This</Button>
            </>
          ) : (
            <Button onClick={handleCapture} disabled={!mediaStream}>
              <CameraIcon />
              Capture
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
