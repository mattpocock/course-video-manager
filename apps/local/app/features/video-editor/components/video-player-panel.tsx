import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LivePreviewFrame } from "./live-preview-frame";
import { getHasLivePreview } from "../live-preview";
import { SilenceLengthToggle } from "./silence-length-toggle";
import { CvmRecorderControls } from "./cvm-recorder-controls";
import { CalibrationGateBanner } from "./calibration-gate-banner";
import { showsCvmRecorderControls } from "../recorder-choice-reducer";
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
  getIsOBSActive as getIsOBSActiveSelector,
  getShowScrubSlider as getShowScrubSliderSelector,
} from "../video-editor-selectors";
import { MonitorSpeaker, VideoOffIcon, Workflow } from "lucide-react";
import { diagramChannel } from "@/lib/diagram-protocol";
import { usePopupOpen } from "../hooks/use-popup-open";
import { useFetcher, useNavigate } from "react-router";
import { videoMenuGroups } from "@/features/video-menu/video-menu";
import { useEditorVideoActions } from "../editor-video-menu";
import { useNewShortAction } from "../new-short-action";
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
  const liveMediaStream = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.liveMediaStream
  );
  const showVideoPlayer = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.showVideoPlayer
  );
  const obsConnectorState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.obsConnectorState
  );
  const cvmRecorderState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.cvmRecorder.state
  );
  const recorder = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.recorderPicker.recorder
  );
  const obsGate = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.calibrationGate.obs
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
  const allClipsHaveText = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.allClipsHaveText
  );
  const videoId = useContextSelector(VideoEditorContext, (ctx) => ctx.videoId);
  const referenceCandidates = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.referenceCandidates
  );
  const referenceVideoId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.referenceVideoId
  );
  const setReferenceVideoId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setReferenceVideoId
  );
  const onOpenAutofillChaptersModal = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onOpenAutofillChaptersModal
  );
  const isAddVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.openModal === "add-video"
  );
  const onAddVideoModalOpenChange = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onModalOpenChange["add-video"]
  );
  const modalDispatch = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.modalDispatch
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
  const openInVSCodeFetcher = useFetcher();
  const editorVideoActions = useEditorVideoActions();
  const newShort = useNewShortAction();
  const navigate = useNavigate();

  const chapters = useMemo(() => getChaptersSelector(items), [items]);
  const hasSections = getHasSectionsSelector(items);

  const isOBSActive = getIsOBSActiveSelector(obsConnectorState);
  const hasLivePreview = getHasLivePreview(liveMediaStream, cvmRecorderState);
  const showScrubSlider = getShowScrubSliderSelector(
    currentClip?.type,
    showVideoPlayer
  );

  const isReferenceOpen =
    referenceVideoId !== null &&
    referenceCandidates.some((c) => c.id === referenceVideoId);
  const menuGroups = videoMenuGroups({
    ...editorVideoActions.menu,
    openInVSCode: lessonId
      ? () =>
          openInVSCodeFetcher.submit(
            {},
            { method: "post", action: `/api/videos/${videoId}/open-in-vscode` }
          )
      : undefined,
    createConcatenatedVideo: () =>
      navigate(`/videos/concatenate?initial=${videoId}`),
    reference: isReferenceOpen
      ? { close: () => setReferenceVideoId(null) }
      : { candidates: referenceCandidates, open: setReferenceVideoId },
    editLessonBody: lessonId
      ? () => setIsLessonBodyWriterOpen(true)
      : undefined,
    autofillDescription: lessonId
      ? () => setIsSeoDescriptionOpen(true)
      : undefined,
    newShort,
    autofillChapters: {
      onSelect: onOpenAutofillChaptersModal,
      disabled: !allClipsHaveText,
      description: allClipsHaveText
        ? undefined
        : "Waiting for transcription to complete",
    },
    addNote: () => modalDispatch({ type: "add-note-from-clipboard-clicked" }),
    addVideoToLesson: lessonId
      ? () => modalDispatch({ type: "add-video-to-lesson-clicked" })
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
                {recorder === "obs"
                  ? "No video stream or clips yet. Connect OBS to start recording."
                  : "No clips yet. This Video records with the CVM recorder."}
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

          {isOBSActive && (
            <div className="mt-2 flex flex-col items-center gap-2">
              {obsConnectorState.type === "obs-connected" && (
                <CalibrationGateBanner
                  gate={obsGate}
                  refusal={obsConnectorState.calibrationRefusal}
                />
              )}
              <SilenceLengthToggle />
            </div>
          )}
          {showsCvmRecorderControls({ recorder }) && <CvmRecorderControls />}

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
              groups={menuGroups}
              allClipsHaveSilenceDetected={allClipsHaveSilenceDetected}
            />
            {/* Each launcher shows only while its popup is closed. */}
            {!isTeleprompterOpen && (
              <Button
                variant="secondary"
                onClick={editorVideoActions.launch.teleprompter}
              >
                <MonitorSpeaker className="w-4 h-4 mr-1" />
                Teleprompter
              </Button>
            )}
            {!isDiagramPlaygroundOpen && (
              <Button
                variant="secondary"
                onClick={editorVideoActions.launch.diagramPlayground}
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
