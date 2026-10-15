import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LivePreviewFrame } from "./live-preview-frame";
import { CvmRecorderControls } from "./cvm-recorder-controls";
import { getHasLivePreview } from "../live-preview";
import { ActionsDropdown } from "./actions-dropdown";
import { videoMenuGroups } from "@/features/video-menu/video-menu";
import { useEditorVideoActions } from "../editor-video-menu";
import { MissingWordTimingBadge } from "./transcript-word-actions";
import { PreloadableClipManager } from "../preloadable-clip";
import type { ClipOverlay } from "../overlay-preview";
import { getShowScrubSlider as getShowScrubSliderSelector } from "../video-editor-selectors";
import { formatDuration } from "@/lib/format-duration";
import { SendIcon, VideoOffIcon } from "lucide-react";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { useState, useCallback, type ChangeEvent } from "react";
import {
  ShortsPostingModal,
  type ShortsPostingMode,
} from "@/features/video-posting/shorts-posting-modal";

export const PortraitStudioPanel = () => {
  const footageNotFound = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.footageNotFound
  );
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
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const cvmRecorderState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.state
  );
  // A Short records with the CVM recorder only (ADR 0037): its 9:16
  // composite and controls, never OBS's.
  const hasLivePreview = getHasLivePreview(liveMediaStream, cvmRecorderState);

  const [isPostingModalOpen, setIsPostingModalOpen] = useState(false);
  const [postingMode, setPostingMode] = useState<ShortsPostingMode>("both");
  const openPostingModal = useCallback((mode: ShortsPostingMode) => {
    setPostingMode(mode);
    setIsPostingModalOpen(true);
  }, []);

  const editorVideoActions = useEditorVideoActions();
  const menuGroups = videoMenuGroups({
    ...editorVideoActions.menu,
    postShort: () => openPostingModal("both"),
    postToYouTube: () => openPostingModal("youtube"),
    postToTikTok: () => openPostingModal("tiktok"),
  });

  const showScrubSlider = getShowScrubSliderSelector(
    currentClip?.type,
    showVideoPlayer
  );

  return (
    <div className="lg:flex-1 relative order-1 lg:order-2 h-full min-h-0 flex flex-col">
      {/* 9:16 height-driven preview */}
      <div className="flex-1 min-h-0 flex items-center justify-center relative">
        {!hasLivePreview && clips.length === 0 ? (
          <div className="h-full aspect-[9/16] bg-card rounded-lg flex flex-col items-center justify-center gap-3">
            <VideoOffIcon className="size-10 text-muted-foreground" />
            <p className="text-muted-foreground text-sm text-center px-4">
              No clips yet. This Short records with the CVM recorder.
            </p>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center max-h-full">
            <LivePreviewFrame />
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
                // Definition Cards — the only Overlay content-kind this PR
                // previews — are a landscape/course-video feature (see
                // `OVERLAY_RENDER_FRAME` in `overlay-render-cache.ts`); the
                // Shorts studio has no overlay preview of its own yet.
                overlaysByClipId={NO_OVERLAYS}
                footageNotFound={footageNotFound}
              />
            </div>

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

      <div className="shrink-0">
        <CvmRecorderControls />
      </div>

      {/* Compact actions bar */}
      <div className="flex items-center justify-between mt-1 shrink-0">
        <span className="text-xs text-muted-foreground truncate">
          {videoTitle}
          {" · " + formatDuration(totalDuration)}
        </span>
        <MissingWordTimingBadge />
        <div className="flex items-center gap-1 shrink-0">
          <ActionsDropdown
            videoId={videoId}
            groups={menuGroups}
            allClipsHaveSilenceDetected={allClipsHaveSilenceDetected}
          />
          <Button size="sm" onClick={() => openPostingModal("both")}>
            <SendIcon className="w-3.5 h-3.5 mr-1" />
            Post
          </Button>
        </div>
      </div>

      <ShortsPostingModal
        open={isPostingModalOpen}
        onOpenChange={setIsPostingModalOpen}
        videoId={videoId}
        videoTitle={videoTitle}
        mode={postingMode}
      />
    </div>
  );
};

/** A stable empty map — the Shorts studio has no overlay preview yet. */
const NO_OVERLAYS = new Map<string, ClipOverlay[]>();
