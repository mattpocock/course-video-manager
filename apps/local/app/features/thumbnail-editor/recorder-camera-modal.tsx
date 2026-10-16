import { useEffect } from "react";
import { CameraIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { canRetryCamera } from "@/features/video-editor/cvm-recorder-reducer";
import { LatestFrameCanvas } from "@/features/video-editor/components/latest-frame-canvas";
import { cameraWaitText } from "./recorder-still-reducer";
import { useRecorderStill } from "./use-recorder-still";

type RecorderCameraModalProps = {
  videoId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (dataUrl: string) => void;
};

/**
 * The thumbnail camera: the raw camera preview from the recorder service,
 * and Capture takes a full-size still from it.
 */
export function RecorderCameraModal(props: RecorderCameraModalProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Capture Photo</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open: its listening keeps the recorder open. */}
        {props.open && <RecorderCameraBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function RecorderCameraBody({
  videoId,
  onOpenChange,
  onCapture,
}: RecorderCameraModalProps) {
  const { state, dispatch, canCapture } = useRecorderStill(videoId);
  const waitText = cameraWaitText(state);
  const preview = state.recorder.previews?.camera;
  const error = state.error ?? state.recorder.error;

  // Space captures, as in the Virtual Camera modal.
  useEffect(() => {
    if (!canCapture) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      dispatch({ type: "press-capture" });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [canCapture, dispatch]);

  return (
    <>
      <div
        className="relative aspect-video w-full overflow-hidden rounded-lg bg-black"
        data-testid="recorder-camera"
      >
        {state.still ? (
          <img
            src={state.still}
            alt="Captured frame"
            className="h-full w-full object-contain"
          />
        ) : !waitText && preview ? (
          <LatestFrameCanvas
            url={preview}
            aria-label="Camera preview"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <span>{waitText ?? "Connecting to camera..."}</span>
            {canRetryCamera(state.recorder) && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => dispatch({ type: "press-retry" })}
              >
                <RotateCcwIcon className="size-3.5 mr-1" />
                Retry
              </Button>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-yellow-500">{error}</p>}

      <div className="flex justify-end gap-2">
        {state.still ? (
          <>
            <Button
              variant="outline"
              onClick={() => dispatch({ type: "press-retake" })}
            >
              <RefreshCwIcon />
              Retake
            </Button>
            <Button
              onClick={() => {
                if (!state.still) return;
                onCapture(state.still);
                onOpenChange(false);
              }}
            >
              Use This
            </Button>
          </>
        ) : (
          <Button
            onClick={() => dispatch({ type: "press-capture" })}
            disabled={!canCapture}
          >
            <CameraIcon />
            {state.taking ? "Capturing…" : "Capture"}
          </Button>
        )}
      </div>
    </>
  );
}
