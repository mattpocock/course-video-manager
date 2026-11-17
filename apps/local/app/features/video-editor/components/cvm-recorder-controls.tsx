import { Button } from "@/components/ui/button";
import { RotateCcwIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { SilenceLengthToggle } from "./silence-length-toggle";
import { ShortScreenStatus } from "./short-screen-status";
import { CalibrationGateBanner } from "./calibration-gate-banner";
import { isCalibrationRefusal } from "@/av-calibration-constants";
import {
  canRecord,
  canRetryCamera,
  framesLostAlert,
  type cvmRecorderReducer,
} from "../cvm-recorder-reducer";
import { useCvmRecorderSelector } from "../use-cvm-recorder-selector";

/**
 * Whether the recorder is simply fine — ready, recording or stopping — so a
 * Short's studio, which gives every pixel it can to the preview, and the
 * Streaming tab, whose takes the teleprompter reports, say nothing.
 */
const isRecorderSettled = (state: cvmRecorderReducer.State): boolean => {
  if (!state.reachable || state.problem) return false;
  if (state.phase !== "idle") return true;
  return state.camera.kind === "live" && canRecord(state);
};

/** What the CVM recorder is doing, in a few words. */
const statusText = (state: cvmRecorderReducer.State): string => {
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
          return canRecord(state)
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
  const camera = useCvmRecorderSelector((state) => state.camera);
  const canRetry = useCvmRecorderSelector(canRetryCamera);
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
        disabled={!canRetry}
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
 * saved. `quiet` (the Streaming tab) treats a Landscape Video as a Short
 * does: no Silence Length, and a status only when something is wrong.
 */
export const CvmRecorderControls = (props: { quiet?: boolean }) => {
  const controls = useCvmRecorderControls();
  const gate = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.calibrationGate
  );
  const isShort = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoFormat === "short"
  );
  // Each a slice: a report that changes none of them renders nothing here.
  const error = useCvmRecorderSelector((state) => state.error);
  const alert = useCvmRecorderSelector((state) => state.alert);
  const idle = useCvmRecorderSelector((state) => state.phase === "idle");
  const settled = useCvmRecorderSelector(isRecorderSettled);
  const status = useCvmRecorderSelector(statusText);
  const framesLost = useCvmRecorderSelector(framesLostAlert);
  const lastFramesLost = useCvmRecorderSelector((state) => state.framesLost);
  const calibrationRefusal = isCalibrationRefusal(error);
  const quiet = isShort || props.quiet === true;
  const showStatus = !quiet || !settled;
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
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="shrink-0 text-white hover:bg-red-700 hover:text-white"
            aria-label="Dismiss the frames-lost alert"
            title="Hide until a Clip loses more frames"
            onClick={controls.onDismissFramesLost}
          >
            <XIcon className="size-5" />
          </Button>
        </div>
      )}
      {alert && (
        <div
          role="alert"
          data-testid="cvm-recorder-alert"
          className="flex w-full max-w-xl items-start gap-3 rounded-md border-2 border-red-600 bg-red-600/10 p-3 text-sm font-semibold text-red-700 dark:text-red-200"
        >
          <TriangleAlertIcon className="size-5 shrink-0 text-red-500" />
          <p className="flex-1">{alert}</p>
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
      {idle && (
        <CalibrationGateBanner
          gate={gate}
          refusal={calibrationRefusal ? error : null}
        />
      )}
      {(!quiet || showStatus) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {!quiet && <SilenceLengthToggle />}
          {showStatus && (
            <span
              className="text-xs text-muted-foreground"
              data-testid="cvm-recorder-status"
            >
              {status}
            </span>
          )}
        </div>
      )}
      <ShortScreenStatus />
      <CameraProblem />
      {lastFramesLost && !framesLost && idle && (
        <p className="text-xs text-muted-foreground">
          Last recording: no frames lost in a Clip
          {lastFramesLost.screen === null ? " (screen not measured)" : ""}
        </p>
      )}
      {error && !calibrationRefusal && (
        <p className="text-xs text-red-500 whitespace-pre-line text-center">
          {error}
        </p>
      )}
    </div>
  );
};
