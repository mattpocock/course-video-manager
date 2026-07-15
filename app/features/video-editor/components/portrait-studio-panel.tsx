import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LiveMediaStream } from "./live-media-stream";
import { SilenceLengthToggle } from "./silence-length-toggle";
import { RecordingSignalIndicator } from "./timeline-indicators";
import { StudioActionsDropdown } from "./studio-actions-dropdown";
import { PreloadableClipManager } from "../preloadable-clip";
import {
  getIsOBSActive as getIsOBSActiveSelector,
  getShouldShowLastFrameOverlay as getShouldShowLastFrameOverlaySelector,
  getShowCenterLine as getShowCenterLineSelector,
  getShowScrubSlider as getShowScrubSliderSelector,
} from "../video-editor-selectors";
import { formatSecondsToTimeCode } from "@/services/utils";
import { SendIcon, VideoOffIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import {
  useState,
  useCallback,
  useContext,
  useEffect,
  type ChangeEvent,
} from "react";
import { UploadContext } from "@/features/upload-manager/upload-context";
import { ShortsPostingModal } from "@/features/video-posting/shorts-posting-modal";

export const PortraitStudioPanel = () => {
  const videoTitle = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoTitle
  );
  const totalDuration = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.totalDuration
  );
  const liveMediaStream = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.liveMediaStream
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
  const databaseClipToShowLastFrameOf = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.databaseClipToShowLastFrameOf
  );
  const clipsToAggressivelyPreload = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.clipsToAggressivelyPreload
  );
  const clips = useContextSelector(VideoEditorContext, (ctx) => ctx.clips);
  const clipIdsPreloaded = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.clipIdsPreloaded
  );
  const runningState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.runningState
  );
  const currentClipId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.currentClipId
  );
  const currentClipProfile = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.currentClipProfile
  );
  const currentClip = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.currentClip
  );
  const scrubSeekTime = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.scrubSeekTime
  );
  const dispatch = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.dispatch
  );
  const onClipFinished = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onClipFinished
  );
  const onUpdateCurrentTime = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onUpdateCurrentTime
  );
  const playbackRate = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.playbackRate
  );
  const allClipsHaveSilenceDetected = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.allClipsHaveSilenceDetected
  );
  const allClipsHaveText = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.allClipsHaveText
  );
  const { startExportUpload, startRenderVerticalUpload } =
    useContext(UploadContext);
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const isCopied = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isCopied
  );
  const copyTranscriptToClipboard = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.copyTranscriptToClipboard
  );
  const youtubeChapters = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.youtubeChapters
  );
  const isChaptersCopied = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isChaptersCopied
  );
  const copyYoutubeChaptersToClipboard = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.copyYoutubeChaptersToClipboard
  );
  const setIsRenameVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setIsRenameVideoModalOpen
  );
  const revealVideoFetcher = useFetcher();

  const [isPostingModalOpen, setIsPostingModalOpen] = useState(false);

  const [exportFileExists, setExportFileExists] = useState(false);
  useEffect(() => {
    fetch(`/api/videos/${videoId}/export-file-exists`)
      .then((res) => res.json())
      .then((data: { exists: boolean }) => setExportFileExists(data.exists))
      .catch(() => setExportFileExists(false));
  }, [videoId]);

  const [isLogPathCopied, setIsLogPathCopied] = useState(false);
  const copyLogPathToClipboard = useCallback(async () => {
    try {
      const res = await fetch(`/api/videos/${videoId}/log-path`);
      const logPath = await res.text();
      await navigator.clipboard.writeText(logPath);
      setIsLogPathCopied(true);
      setTimeout(() => setIsLogPathCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy log path:", error);
    }
  }, [videoId]);

  const isOBSActive = getIsOBSActiveSelector(obsConnectorState);
  const shouldShowLastFrameOverlay = getShouldShowLastFrameOverlaySelector(
    databaseClipToShowLastFrameOf,
    showLastFrame,
    obsConnectorState
  );
  const showCenterLine = getShowCenterLineSelector(obsConnectorState);
  const showScrubSlider = getShowScrubSliderSelector(
    currentClip?.type,
    showVideoPlayer
  );

  return (
    <div className="lg:flex-1 relative order-1 lg:order-2 h-full min-h-0 flex flex-col">
      {/* Header bar: title + Post + Actions */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h1 className="text-lg font-bold truncate mr-4">
          {videoTitle}
          {" (" + formatSecondsToTimeCode(totalDuration) + ")"}
        </h1>
        <div className="flex gap-2 shrink-0">
          <StudioActionsDropdown
            allClipsHaveSilenceDetected={allClipsHaveSilenceDetected}
            allClipsHaveText={allClipsHaveText}
            onExport={() => startExportUpload(videoId, videoTitle)}
            onRenderVertical={() =>
              startRenderVerticalUpload(videoId, videoTitle)
            }
            onPostShorts={() => setIsPostingModalOpen(true)}
            videoId={videoId}
            isCopied={isCopied}
            copyTranscriptToClipboard={copyTranscriptToClipboard}
            youtubeChapters={youtubeChapters}
            isChaptersCopied={isChaptersCopied}
            copyYoutubeChaptersToClipboard={copyYoutubeChaptersToClipboard}
            onRenameVideoClick={() => setIsRenameVideoModalOpen(true)}
            onRevealInFileSystem={
              exportFileExists
                ? () => {
                    revealVideoFetcher.submit(
                      {},
                      {
                        method: "post",
                        action: `/api/videos/${videoId}/reveal`,
                      }
                    );
                  }
                : undefined
            }
            isLogPathCopied={isLogPathCopied}
            copyLogPathToClipboard={copyLogPathToClipboard}
          />
          <Button onClick={() => setIsPostingModalOpen(true)}>
            <SendIcon className="w-4 h-4 mr-2" />
            Post
          </Button>
        </div>
      </div>

      {/* 9:16 height-driven preview */}
      <div className="flex-1 min-h-0 flex items-center justify-center">
        {!liveMediaStream && clips.length === 0 ? (
          <div className="h-full aspect-[9/16] bg-card rounded-lg flex flex-col items-center justify-center gap-3">
            <VideoOffIcon className="size-10 text-muted-foreground" />
            <p className="text-muted-foreground text-sm text-center px-4">
              No video stream or clips yet. Connect OBS to start recording.
            </p>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center max-h-full">
            {liveMediaStream && (
              <div
                className={cn(
                  "flex-1 min-h-0 aspect-[9/16] relative",
                  "hidden",
                  !showVideoPlayer &&
                    (showLiveStream || showLastFrame) &&
                    "block"
                )}
              >
                {obsConnectorState.type === "obs-recording" && (
                  <RecordingSignalIndicator />
                )}

                {isOBSActive && (
                  <LiveMediaStream
                    mediaStream={liveMediaStream}
                    obsConnectorState={obsConnectorState}
                    speechDetectorState={speechDetectorState}
                    showCenterLine={showCenterLine}
                  />
                )}
                {!showVideoPlayer &&
                  shouldShowLastFrameOverlay &&
                  databaseClipToShowLastFrameOf && (
                    <div className="absolute inset-0 rounded-lg">
                      <img
                        className="w-full h-full rounded-lg opacity-50 object-contain"
                        src={`/clips/${databaseClipToShowLastFrameOf.databaseId}/last-frame`}
                      />
                    </div>
                  )}
              </div>
            )}
            <div
              className={cn(
                "flex-1 min-h-0 aspect-[9/16]",
                !showVideoPlayer && "hidden"
              )}
            >
              <PreloadableClipManager
                clipsToAggressivelyPreload={clipsToAggressivelyPreload}
                clips={clips
                  .filter((clip) => clipIdsPreloaded.has(clip.frontendId))
                  .filter((clip) => clip.type === "on-database")}
                finalClipId={clips[clips.length - 1]?.frontendId}
                state={runningState}
                currentClipId={currentClipId}
                currentClipProfile={currentClipProfile}
                onClipFinished={onClipFinished}
                onUpdateCurrentTime={onUpdateCurrentTime}
                playbackRate={playbackRate}
                scrubSeekTime={scrubSeekTime}
              />
            </div>

            {isOBSActive && (
              <div className="mt-2 flex justify-center shrink-0">
                <SilenceLengthToggle />
              </div>
            )}

            {showScrubSlider && currentClip?.type === "on-database" && (
              <input
                type="range"
                className="scrub-slider mt-2 w-full max-w-xs shrink-0"
                min={currentClip.sourceStartTime}
                max={currentClip.sourceEndTime}
                step={0.01}
                value={scrubSeekTime ?? currentClip.sourceStartTime}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  dispatch({
                    type: "scrub-to-time",
                    time: parseFloat(e.target.value),
                  });
                }}
              />
            )}
          </div>
        )}
      </div>

      <ShortsPostingModal
        open={isPostingModalOpen}
        onOpenChange={setIsPostingModalOpen}
        videoId={videoId}
        videoTitle={videoTitle}
      />
    </div>
  );
};
