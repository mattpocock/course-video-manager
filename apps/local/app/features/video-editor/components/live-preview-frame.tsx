import { cn } from "@/lib/utils";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { clipStillUrl } from "../clip-still-url";
import { getCvmRecorderLivePreview } from "../live-preview";
import { getShowRecordingSignal } from "../video-editor-selectors";
import { CaptureFrame } from "./capture-frame";
import { CompositePreview } from "./composite-preview";
import { RecordingSignalIndicator } from "./timeline-indicators";

/**
 * The editor's live frame: the live picture while paused, with the previous
 * Clip's last frame over it at half opacity to match position between takes.
 * The picture is the CVM recorder's composite, with the capture badge, ring,
 * recording signal and centre line. A Short's frame is portrait 9:16, the
 * CVM recorder's Short layout.
 * Renders nothing while there is no live picture (the Clip player shows).
 */
export const LivePreviewFrame = () => {
  const cvmRecorderState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.state
  );
  const showVideoPlayer = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.showVideoPlayer
  );
  const showLiveStream = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.showLiveStream
  );
  const showLastFrame = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.showLastFrame
  );
  const speechDetectorState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.speechDetectorState
  );
  const isRecordingActive = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isRecordingActive
  );
  const isTeleprompterConnected = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isTeleprompterConnected
  );
  const lastFrameClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.databaseClipToShowLastFrameOf
  );

  const composite = getCvmRecorderLivePreview(cvmRecorderState);
  if (!composite) return null;

  const showLastFrameOverlay = lastFrameClip !== undefined && showLastFrame;
  const showRecordingSignal = getShowRecordingSignal(
    isRecordingActive,
    isTeleprompterConnected
  );

  return (
    <div
      className={cn(
        "relative",
        composite.format === "short"
          ? // As tall as the Short's studio allows, like its Clip player.
            "flex-1 min-h-0 aspect-[9/16]"
          : "w-full aspect-[16/9]",
        "hidden",
        !showVideoPlayer && (showLiveStream || showLastFrame) && "block"
      )}
      data-testid="live-preview-frame"
    >
      {showRecordingSignal && <RecordingSignalIndicator />}

      <CaptureFrame
        isRecording={isRecordingActive}
        speechDetectorState={speechDetectorState}
        showCenterLine={composite.showCenterLine}
        showCaptureStatus={!isTeleprompterConnected}
      >
        <CompositePreview
          previews={composite.previews}
          scene={composite.scene}
          format={composite.format}
          cameraShowing={composite.cameraShowing}
          cameraKey={composite.cameraKey}
        />
      </CaptureFrame>
      {!showVideoPlayer && showLastFrameOverlay && lastFrameClip && (
        <div className="absolute inset-0 rounded-lg">
          <img
            className="w-full h-full rounded-lg opacity-50 object-contain"
            src={clipStillUrl(lastFrameClip, "last")}
          />
        </div>
      )}
    </div>
  );
};
