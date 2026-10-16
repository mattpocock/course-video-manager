import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LivePreviewFrame } from "./live-preview-frame";
import { getHasLivePreview } from "../live-preview";
import { CvmRecorderControls } from "./cvm-recorder-controls";
import { TableOfContents } from "./table-of-contents";
import { DeferredAddVideoModal } from "./deferred-fs-panels";
import { ActionsDropdown } from "./actions-dropdown";
import { VideoPlayerStatusStrip } from "./video-player-status-strip";
import { LessonBodyWriterModal } from "@/features/lesson-writer/lesson-body-writer-modal";
import { AutofillDescriptionModal } from "@/features/lesson-writer/autofill-description-modal";
import { PreloadableClipManager } from "../preloadable-clip";
import {
  getChapters as getChaptersSelector,
  getHasSections as getHasSectionsSelector,
  getShowScrubSlider as getShowScrubSliderSelector,
} from "../video-editor-selectors";
import { MonitorSpeaker, VideoOffIcon, Workflow } from "lucide-react";
import { diagramChannel } from "@/lib/diagram-protocol";
import { usePopupOpen } from "../hooks/use-popup-open";
import { useEditorVideoMenu } from "../editor-video-menu";
import { useContextSelector } from "use-context-selector";
import { VideoEditorContext } from "../video-editor-context";
import { Suspense, useState, useMemo, type ChangeEvent } from "react";

export const VideoPlayerPanel = () => {
  const lessonId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.lessonId
  );
  const [isLessonBodyWriterOpen, setIsLessonBodyWriterOpen] = useState(false);
  const [isSeoDescriptionOpen, setIsSeoDescriptionOpen] = useState(false);
  const showVideoPlayer = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.showVideoPlayer
  );
  const cvmRecorderState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.state
  );
  const clipsToAggressivelyPreload = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.clipsToAggressivelyPreload
  );
  const clips = useContextSelector(VideoEditorContext, (ctx) => ctx.clips);
  const overlaysByClipId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.overlaysByClipId
  );
  const footageNotFound = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.footageNotFound
  );
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
  const isAddVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.openModal === "add-video"
  );
  const onAddVideoModalOpenChange = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onModalOpenChange["add-video"]
  );
  const isTeleprompterOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isTeleprompterConnected
  );
  const isDiagramPlaygroundOpen = usePopupOpen(diagramChannel);
  const items = useContextSelector(VideoEditorContext, (ctx) => ctx.items);
  const fsData = useContextSelector(VideoEditorContext, (ctx) => ctx.fsData);
  const selectedClipsSet = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.selectedClipsSet
  );
  const videoCount = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoCount
  );

  const chapters = useMemo(() => getChaptersSelector(items), [items]);
  const hasSections = getHasSectionsSelector(items);

  const hasLivePreview = getHasLivePreview(cvmRecorderState);
  const showScrubSlider = getShowScrubSliderSelector(
    currentClip?.type,
    showVideoPlayer
  );

  const menu = useEditorVideoMenu({
    editLessonBody: lessonId
      ? () => setIsLessonBodyWriterOpen(true)
      : undefined,
    autofillDescription: lessonId
      ? () => setIsSeoDescriptionOpen(true)
      : undefined,
  });
  return (
    <>
      <div className="lg:flex-1 relative order-1 lg:order-2 overflow-y-auto h-full">
        <div className="">
          <VideoPlayerStatusStrip />

          {!hasLivePreview && clips.length === 0 ? (
            <div className="w-full aspect-[16/9] bg-card rounded-lg flex flex-col items-center justify-center gap-3">
              <VideoOffIcon className="size-10 text-muted-foreground" />
              <p className="text-muted-foreground text-sm text-center px-4">
                No clips yet. This Video records with the CVM recorder.
              </p>
            </div>
          ) : (
            <>
              <LivePreviewFrame />
              <div
                className={cn(
                  // overflow-hidden is what makes a Clip Zoom read as a
                  // crop rather than as an oversized video: the zoomed
                  // <video> is scaled past its box and clipped back to frame.
                  "w-full aspect-[16/9] overflow-hidden",
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
                  overlaysByClipId={overlaysByClipId}
                  footageNotFound={footageNotFound}
                />
              </div>
            </>
          )}

          <CvmRecorderControls />

          {showScrubSlider && currentClip?.type === "on-database" && (
            <input
              type="range"
              className="scrub-slider mt-2"
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

          <div className="flex gap-2 mt-4">
            <ActionsDropdown
              videoId={videoId}
              groups={menu.groups}
              allClipsHaveSilenceDetected={allClipsHaveSilenceDetected}
            />
            {/* Each launcher shows only while its popup is closed. */}
            {!isTeleprompterOpen && (
              <Button variant="secondary" onClick={menu.launch.teleprompter}>
                <MonitorSpeaker className="w-4 h-4 mr-1" />
                Teleprompter
              </Button>
            )}
            {!isDiagramPlaygroundOpen && (
              <Button
                variant="secondary"
                onClick={menu.launch.diagramPlayground}
              >
                <Workflow className="w-4 h-4 mr-1" />
                Diagram Playground
              </Button>
            )}
          </div>

          {hasSections && (
            <div className="mt-6 border-t border-border pt-4">
              <h2 className="px-3 py-1.5 mb-3 text-sm font-medium">Sections</h2>
              <TableOfContents
                chapters={chapters}
                selectedClipsSet={selectedClipsSet}
                onChapterClick={(chapterId) =>
                  dispatch({
                    type: "click-clip",
                    clipId: chapterId,
                    ctrlKey: false,
                    shiftKey: false,
                  })
                }
              />
            </div>
          )}
        </div>
      </div>

      <Suspense>
        <DeferredAddVideoModal
          fsData={fsData}
          lessonId={lessonId}
          videoCount={videoCount}
          open={isAddVideoModalOpen}
          onOpenChange={onAddVideoModalOpenChange}
        />
      </Suspense>

      {lessonId && isLessonBodyWriterOpen && (
        <LessonBodyWriterModal
          videoId={videoId}
          open={isLessonBodyWriterOpen}
          onOpenChange={setIsLessonBodyWriterOpen}
        />
      )}

      {lessonId && isSeoDescriptionOpen && (
        <AutofillDescriptionModal
          videoId={videoId}
          open={isSeoDescriptionOpen}
          onOpenChange={setIsSeoDescriptionOpen}
        />
      )}
    </>
  );
};
