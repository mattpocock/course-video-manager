import { cn } from "@/lib/utils";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { clipStillUrl } from "../clip-still-url";
import { holdsStillsOf, stillRound } from "../cvm-recorder-reducer";
import { getCvmRecorderLivePreview } from "../live-preview";
import {
  getIsOBSActive,
  getShouldShowLastFrameOverlay,
  getShowCenterLine,
  getShowRecordingSignal,
} from "../video-editor-selectors";
import { CaptureFrame, LiveMediaStream } from "./live-media-stream";
import { CompositePreview } from "./composite-preview";
import { RecordingSignalIndicator } from "./timeline-indicators";

/**
 * The editor's live frame: the live picture while paused, with the previous
 * Clip's last frame over it at half opacity to match position between takes.
 * OBS fills it with its Virtual Camera; the CVM recorder with its composite.
 * Both get the same capture badge, ring, recording signal and centre line.
 * A Short's frame is portrait 9:16, the CVM recorder's Short layout (a
 * Short never records with OBS, ADR 0037).
 * Renders nothing while there is no live picture (the Clip player shows).
 */
export const LivePreviewFrame = () => {
  const liveMediaStream = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.liveMediaStream
  );
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
  const obsConnectorState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.obsConnectorState
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
  if (!liveMediaStream && !composite) return null;

  const showLastFrameOverlay = getShouldShowLastFrameOverlay(
    lastFrameClip,
    showLastFrame,
    obsConnectorState
  );
  const showRecordingSignal = getShowRecordingSignal(
    isRecordingActive,
    isTeleprompterConnected
  );

  return (
    <div
      className={cn(
        "w-full relative aspect-[16/9]",
        composite?.format === "short" && "w-92 aspect-[9/16]",
        "hidden",
        !showVideoPlayer && (showLiveStream || showLastFrame) && "block"
      )}
      data-testid="live-preview-frame"
    >
      {showRecordingSignal && <RecordingSignalIndicator />}

      {liveMediaStream && getIsOBSActive(obsConnectorState) && (
        <LiveMediaStream
          mediaStream={liveMediaStream}
          obsConnectorState={obsConnectorState}
          speechDetectorState={speechDetectorState}
          showCenterLine={getShowCenterLine(obsConnectorState)}
          showCaptureStatus={!isTeleprompterConnected}
        />
      )}
      {composite && (
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
      )}
      {!showVideoPlayer &&
        showLastFrameOverlay &&
        lastFrameClip &&
        // Its take is still recording: no still until Stop (#2214).
        !holdsStillsOf(cvmRecorderState, lastFrameClip) && (
          <div className="absolute inset-0 rounded-lg">
            <img
              key={stillRound(cvmRecorderState)}
              className="w-full h-full rounded-lg opacity-50 object-contain"
              src={clipStillUrl(lastFrameClip, "last")}
            />
          </div>
        )}
    </div>
  );
};
