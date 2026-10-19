import { Button } from "@/components/ui/button";
import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { SilenceLengthToggle } from "./silence-length-toggle";
import { ShortScreenStatus } from "./short-screen-status";
import { CalibrationGateBanner } from "./calibration-gate-banner";
import { isCalibrationRefusal } from "@/av-calibration-constants";
import { framesLostAlert } from "../cvm-recorder-reducer";

/**
 * Whether the recorder is simply fine — ready, recording or stopping — so a
 * Short's studio, which gives every pixel it can to the preview, says nothing.
 */
const isRecorderSettled = (
  controls: ReturnType<typeof useCvmRecorderControls>
): boolean => {
  const { state } = controls;
  if (!state.reachable || state.problem) return false;
  if (state.phase !== "idle") return true;
  return state.camera.kind === "live" && controls.canRecord;
};

/** What the CVM recorder is doing, in a few words. */
const statusText = (
  controls: ReturnType<typeof useCvmRecorderControls>
): string => {
  const { state } = controls;
  if (state.reachable === null) return "Connecting to the recorder…";
  if (state.starting) return "Starting the recorder…";
  if (!state.reachable) return "The recorder service is not running.";
  if (state.problem) return state.problem;
  switch (state.phase) {
    case "idle":
      switch (state.camera.kind) {
        case "closed":
          return "Opening the recorder…";
        case "opening":
          return state.camera.attempt > 1
            ? `Opening the Cam Link (try ${state.camera.attempt})…`
            : "Opening the Cam Link…";
        case "not-starting":
        case "busy":
          return "The Cam Link is not live.";
        case "live":
          // Off only on a Short: Spacedesk still waking, or the scene needs a screen that is not ready.
          return controls.canRecord
            ? "Ready to record."
            : "Waiting for the screen.";
      }
    case "recording":
      return state.speech.type === "speaking"
        ? "Recording · speaking"
        : "Recording";
    case "stopping":
      return "Stopping…";
  }
};

const useCvmRecorderControls = () =>
  useContextSelector(VideoEditorContext, (ctx) => ctx.cvmRecorder);

/** The replug and Close-OBS messages, with Retry. */
const CameraProblem = () => {
  const controls = useCvmRecorderControls();
  const { camera } = controls.state;
  if (camera.kind !== "not-starting" && camera.kind !== "busy") return null;
  return (
    <div
      className="flex items-center gap-2 text-sm text-amber-500"
      data-testid="cvm-recorder-camera-problem"
    >
      <span>{camera.message}</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!controls.canRetryCamera}
        onClick={controls.onRetryCamera}
      >
        <RotateCcwIcon className="size-3.5 mr-1" />
        Retry
      </Button>
    </div>
  );
};

/**
 * A CVM recorder Video's status and Silence Length, under the live frame
 * (`LivePreviewFrame`), which draws the composite. A Short shows neither
 * while the recorder is fine: its Silence Length is in the Actions menu, and
 * its status speaks only when something is wrong or not ready yet. Record, Stop and the
 * scene are the Stream Deck's: it calls the recorder service directly.
 * Clips appear in the timeline as the recorder hears each take end, already
 * saved.
 */
export const CvmRecorderControls = () => {
  const controls = useCvmRecorderControls();
  const gate = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.calibrationGate
  );
  const isShort = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoFormat === "short"
  );
  const { state } = controls;
  const calibrationRefusal = isCalibrationRefusal(state.error);
  const showStatus = !isShort || !isRecorderSettled(controls);
  const framesLost = framesLostAlert(state);
  return (
    <div className="mt-2 flex flex-col items-center gap-2 empty:hidden">
      {framesLost && (
        <div
          role="alert"
          data-testid="cvm-recorder-frames-lost"
          className="flex w-full max-w-xl items-center gap-3 rounded-md border-4 border-red-600 bg-red-600 p-4 text-base font-bold uppercase tracking-wide text-white shadow-lg animate-pulse"
        >
          <TriangleAlertIcon className="size-7 shrink-0" />
          <p className="flex-1">{framesLost}</p>
        </div>
      )}
      {state.alert && (
        <div
          role="alert"
          data-testid="cvm-recorder-alert"
          className="flex w-full max-w-xl items-start gap-3 rounded-md border-2 border-red-600 bg-red-600/10 p-3 text-sm font-semibold text-red-700 dark:text-red-200"
        >
          <TriangleAlertIcon className="size-5 shrink-0 text-red-500" />
          <p className="flex-1">{state.alert}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={controls.onDismissAlert}
          >
            Dismiss
          </Button>
        </div>
      )}
      {state.phase === "idle" && (
        <CalibrationGateBanner
          gate={gate}
          refusal={calibrationRefusal ? state.error : null}
        />
      )}
      {(!isShort || showStatus) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {!isShort && <SilenceLengthToggle />}
          {showStatus && (
            <span
              className="text-xs text-muted-foreground"
              data-testid="cvm-recorder-status"
            >
              {statusText(controls)}
            </span>
          )}
        </div>
      )}
      <ShortScreenStatus />
      <CameraProblem />
      {state.framesLost && !framesLost && state.phase === "idle" && (
        <p className="text-xs text-muted-foreground">
          Last recording: no frames lost in a Clip
          {state.framesLost.screen === null ? " (screen not measured)" : ""}
        </p>
      )}
      {state.error && !calibrationRefusal && (
        <p className="text-xs text-red-500 whitespace-pre-line text-center">
          {state.error}
        </p>
      )}
    </div>
  );
};
