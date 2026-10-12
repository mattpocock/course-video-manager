import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LiveMediaStream } from "./live-media-stream";
import { SilenceLengthToggle } from "./silence-length-toggle";
import { NewRecorderControls } from "./new-recorder-controls";
import { showsNewRecorderControls } from "../recorder-choice-reducer";
import { RecordingSignalIndicator } from "./timeline-indicators";
import { TableOfContents } from "./table-of-contents";
import {
  DeferredAddVideoModal,
  DeferredSuggestionsPanel,
} from "./deferred-fs-panels";
import { ActionsDropdown } from "./actions-dropdown";
import { VideoPlayerStatusStrip } from "./video-player-status-strip";
import { LessonBodyWriterModal } from "@/features/lesson-writer/lesson-body-writer-modal";
import { AutofillDescriptionModal } from "@/features/lesson-writer/autofill-description-modal";
import { VideoPlayerLinksTab } from "./video-player-links-tab";
import { VideoMoreActions } from "./video-more-actions";
import { PreloadableClipManager } from "../preloadable-clip";
import {
  getLastTranscribedClipId as getLastTranscribedClipIdSelector,
  getChapters as getChaptersSelector,
  getHasSections as getHasSectionsSelector,
  getIsOBSActive as getIsOBSActiveSelector,
  getIsLiveStreamPortrait as getIsLiveStreamPortraitSelector,
  getShouldShowLastFrameOverlay as getShouldShowLastFrameOverlaySelector,
  getShowCenterLine as getShowCenterLineSelector,
  getShowRecordingSignal as getShowRecordingSignalSelector,
  getShowScrubSlider as getShowScrubSliderSelector,
} from "../video-editor-selectors";
import { ClipboardIcon, VideoOffIcon } from "lucide-react";
import { useFetcher, useNavigate } from "react-router";
import { videoMenuGroups } from "@/features/video-menu/video-menu";
import { useEditorVideoActions } from "../editor-video-menu";
import { useContextSelector } from "use-context-selector";
import {
  VideoEditorContext,
  type SuggestionState,
} from "../video-editor-context";
import {
  Suspense,
  useState,
  useMemo,
  useCallback,
  type ChangeEvent,
} from "react";
import {
  resolveForVideo,
  type ResolverTimelineItem,
} from "@/lib/diagram-action-resolver";
import { fetchMeta } from "@/features/diagrams/use-diagram-snapshot-scene";
import {
  openPlayground,
  openPlaygroundWithDiagram,
} from "@/lib/diagram-window";
import { teleprompterChannel } from "@/lib/teleprompter-protocol";

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
  const recorder = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.recorderPicker.recorder
  );
  const speechDetectorState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.speechDetectorState
  );
  const isTeleprompterConnected = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isTeleprompterConnected
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
  const overlaysByClipId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.overlaysByClipId
  );
  const insertionPoint = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.insertionPoint
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
  const exportToDavinciResolveFetcher = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.exportToDavinciResolveFetcher
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
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<
    "suggestions" | "toc" | "links" | "more"
  >("suggestions");

  // The Suggestions panel reports its state up; the timeline shows it inline.
  const handleSuggestionStateChange = useCallback(
    (suggestion: SuggestionState) => {
      modalDispatch({ type: "suggestion-changed", suggestion });
    },
    [modalDispatch]
  );

  const lastTranscribedClipId = useMemo(
    () => getLastTranscribedClipIdSelector(clips),
    [clips]
  );

  const chapters = useMemo(() => getChaptersSelector(items), [items]);
  const hasSections = getHasSectionsSelector(items);

  const isOBSActive = getIsOBSActiveSelector(obsConnectorState);
  const isLiveStreamPortrait =
    getIsLiveStreamPortraitSelector(obsConnectorState);
  const shouldShowLastFrameOverlay = getShouldShowLastFrameOverlaySelector(
    databaseClipToShowLastFrameOf,
    showLastFrame,
    obsConnectorState
  );
  const showCenterLine = getShowCenterLineSelector(obsConnectorState);
  const showRecordingSignal = getShowRecordingSignalSelector(
    obsConnectorState,
    isTeleprompterConnected
  );
  const showScrubSlider = getShowScrubSliderSelector(
    currentClip?.type,
    showVideoPlayer
  );

  const handleOpenDiagramPlayground = useCallback(async () => {
    const resolverItems: ResolverTimelineItem[] = items.map((item) => {
      if (item.type === "on-database" || item.type === "optimistically-added") {
        return {
          frontendId: item.frontendId as string,
          kind: "clip" as const,
          diagramSnapshotId:
            item.type === "on-database"
              ? (item.diagramSnapshotId ?? null)
              : null,
        };
      }
      return {
        frontendId: item.frontendId as string,
        kind: "chapter" as const,
        diagramSnapshotId: null,
      };
    });

    const snapshotIds = new Set(
      resolverItems
        .filter((i) => i.diagramSnapshotId)
        .map((i) => i.diagramSnapshotId!)
    );
    const snapshotMap = new Map<string, string>();
    await Promise.all(
      [...snapshotIds].map(async (sid) => {
        const meta = await fetchMeta(sid);
        if (meta.diagramId) snapshotMap.set(sid, meta.diagramId);
      })
    );

    const result = resolveForVideo(
      resolverItems,
      insertionPoint,
      (sid) => snapshotMap.get(sid) ?? null
    );
    if (result.kind === "diagram") {
      openPlaygroundWithDiagram(result.diagramId);
    } else {
      openPlayground();
    }
  }, [items, insertionPoint]);

  const isReferenceOpen =
    referenceVideoId !== null &&
    referenceCandidates.some((c) => c.id === referenceVideoId);
  // Rare actions live in the More tab, not the menu (rule 9).
  const moreGroups = videoMenuGroups({
    ...editorVideoActions.rare,
    openInVSCode: lessonId
      ? () =>
          openInVSCodeFetcher.submit(
            {},
            { method: "post", action: `/api/videos/${videoId}/open-in-vscode` }
          )
      : undefined,
    createConcatenatedVideo: () =>
      navigate(`/videos/concatenate?initial=${videoId}`),
    exportToDavinciResolve: () =>
      exportToDavinciResolveFetcher.submit(null, {
        method: "post",
        action: `/videos/${videoId}/export-to-davinci-resolve`,
      }),
  });
  const menuGroups = videoMenuGroups({
    ...editorVideoActions.common,
    openTeleprompter: () => teleprompterChannel.open(),
    openDiagramPlayground: () => void handleOpenDiagramPlayground(),
    reference: isReferenceOpen
      ? { close: () => setReferenceVideoId(null) }
      : { candidates: referenceCandidates, open: setReferenceVideoId },
    editLessonBody: lessonId
      ? () => setIsLessonBodyWriterOpen(true)
      : undefined,
    autofillDescription: lessonId
      ? () => setIsSeoDescriptionOpen(true)
      : undefined,
    autofillChapters: {
      onSelect: onOpenAutofillChaptersModal,
      disabled: !allClipsHaveText,
      description: allClipsHaveText
        ? undefined
        : "Waiting for transcription to complete",
    },
    addVideoToLesson: lessonId
      ? () => modalDispatch({ type: "add-video-to-lesson-clicked" })
      : undefined,
  });
  return (
    <>
      <div className="lg:flex-1 relative order-1 lg:order-2 overflow-y-auto h-full">
        <div className="">
          <VideoPlayerStatusStrip />

          {!liveMediaStream && clips.length === 0 ? (
            <div className="w-full aspect-[16/9] bg-card rounded-lg flex flex-col items-center justify-center gap-3">
              <VideoOffIcon className="size-10 text-muted-foreground" />
              <p className="text-muted-foreground text-sm text-center px-4">
                {recorder === "obs"
                  ? "No video stream or clips yet. Connect OBS to start recording."
                  : "No clips yet. This Video records with the New recorder."}
              </p>
            </div>
          ) : (
            <>
              {liveMediaStream && (
                <div
                  className={cn(
                    "w-full relative aspect-[16/9]",
                    isLiveStreamPortrait && "w-92 aspect-[9/16]",
                    "hidden",
                    !showVideoPlayer &&
                      (showLiveStream || showLastFrame) &&
                      "block"
                  )}
                >
                  {showRecordingSignal && <RecordingSignalIndicator />}

                  {isOBSActive && (
                    <LiveMediaStream
                      mediaStream={liveMediaStream}
                      obsConnectorState={obsConnectorState}
                      speechDetectorState={speechDetectorState}
                      showCenterLine={showCenterLine}
                      showCaptureStatus={!isTeleprompterConnected}
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
                />
              </div>
            </>
          )}

          {isOBSActive && (
            <div className="mt-2 flex justify-center">
              <SilenceLengthToggle />
            </div>
          )}
          {showsNewRecorderControls({ recorder }) && <NewRecorderControls />}

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
              isPending={exportToDavinciResolveFetcher.state === "submitting"}
            />
            <Button
              variant="secondary"
              onClick={() =>
                modalDispatch({ type: "add-note-from-clipboard-clicked" })
              }
            >
              <ClipboardIcon className="w-4 h-4 mr-1" />
              Add Note
            </Button>
          </div>

          {/* Tabbed panel for Suggestions and Table of Contents */}
          <div className="mt-6 border-t border-border pt-4">
            <div className="flex gap-2 mb-3">
              {(
                [
                  ["suggestions", "Suggestions"],
                  ...(hasSections ? [["toc", "Sections"] as const] : []),
                  ["links", "Links"],
                  ["more", "More"],
                ] as const
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded transition-colors",
                    activeTab === tab
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === "suggestions" && (
              <Suspense>
                <DeferredSuggestionsPanel
                  fsData={fsData}
                  videoId={videoId}
                  lastTranscribedClipId={lastTranscribedClipId}
                  clips={clips}
                  insertionPoint={insertionPoint}
                  onSuggestionStateChange={handleSuggestionStateChange}
                />
              </Suspense>
            )}

            {activeTab === "toc" && hasSections && (
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
            )}

            {activeTab === "links" && <VideoPlayerLinksTab />}

            {activeTab === "more" && <VideoMoreActions groups={moreGroups} />}
          </div>
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
