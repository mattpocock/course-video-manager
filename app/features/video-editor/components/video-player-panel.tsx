import { AddVideoModal } from "@/components/add-video-modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatSecondsToTimeCode } from "@/services/utils";
import { LiveMediaStream } from "./live-media-stream";
import { PauseLengthToggle } from "./pause-length-toggle";
import { RecordingSignalIndicator } from "./timeline-indicators";
import { TableOfContents } from "./table-of-contents";
import {
  SuggestionsPanel,
  type SuggestionsPanelProps,
} from "./suggestions-panel";
import { ActionsDropdown } from "./actions-dropdown";
import { VideoPlayerLinksTab } from "./video-player-links-tab";
import { PreloadableClipManager } from "../preloadable-clip";
import {
  getLastTranscribedClipId as getLastTranscribedClipIdSelector,
  getChapters as getChaptersSelector,
  getHasSections as getHasSectionsSelector,
  getIsOBSActive as getIsOBSActiveSelector,
  getIsLiveStreamPortrait as getIsLiveStreamPortraitSelector,
  getShouldShowLastFrameOverlay as getShouldShowLastFrameOverlaySelector,
  getShowCenterLine as getShowCenterLineSelector,
} from "../video-editor-selectors";
import { AlertTriangleIcon, ClipboardIcon, VideoOffIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { useContextSelector } from "use-context-selector";
import {
  VideoEditorContext,
  type SuggestionState,
} from "../video-editor-context";
import {
  Suspense,
  use,
  useState,
  useMemo,
  useCallback,
  useContext,
  useEffect,
  type ChangeEvent,
} from "react";
import { UploadContext } from "@/features/upload-manager/upload-context";
import {
  resolveForVideo,
  type ResolverTimelineItem,
} from "@/lib/diagram-action-resolver";
import { fetchMeta } from "@/features/diagrams/use-diagram-snapshot-scene";
import {
  openPlayground,
  openPlaygroundWithDiagram,
} from "@/lib/diagram-window";

/**
 * Video player panel component displaying video preview, controls, and metadata.
 * Includes live stream, video player, table of contents, and action buttons.
 */
export const VideoPlayerPanel = () => {
  // Use context selectors for all state
  const videoPath = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoPath
  );
  const totalDuration = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.totalDuration
  );
  const areAnyClipsDangerous = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.areAnyClipsDangerous
  );
  const lessonId = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.lessonId
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
  const { startExportUpload } = useContext(UploadContext);
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
  const onOpenGenerateChaptersModal = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onOpenGenerateChaptersModal
  );
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
  const isAddVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.isAddVideoModalOpen
  );
  const setIsAddVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setIsAddVideoModalOpen
  );
  const onAddNoteFromClipboard = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onAddNoteFromClipboard
  );
  const setIsRenameVideoModalOpen = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setIsRenameVideoModalOpen
  );
  const items = useContextSelector(VideoEditorContext, (ctx) => ctx.items);
  const fsData = useContextSelector(VideoEditorContext, (ctx) => ctx.fsData);
  const selectedClipsSet = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.selectedClipsSet
  );
  const onChapterClick = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.onChapterClick
  );
  const videoCount = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.videoCount
  );
  const revealVideoFetcher = useFetcher();
  const openInVSCodeFetcher = useFetcher();

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

  const [activeTab, setActiveTab] = useState<"suggestions" | "toc" | "links">(
    "suggestions"
  );

  // Suggestion state from context (shared with ClipTimeline)
  const setSuggestionState = useContextSelector(
    VideoEditorContext,
    (ctx) => ctx.setSuggestionState
  );

  const handleSuggestionStateChange = useCallback(
    (state: SuggestionState) => {
      setSuggestionState(state);
    },
    [setSuggestionState]
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

  return (
    <>
      <div className="lg:flex-1 relative order-1 lg:order-2 overflow-y-auto h-full">
        <div className="">
          <div className="mb-4">
            <h1 className="text-2xl font-bold mb-1 flex items-center">
              {videoPath}
              {" (" + formatSecondsToTimeCode(totalDuration) + ")"}
              {areAnyClipsDangerous && (
                <span className="text-orange-500 ml-4 text-base font-medium inline-flex items-center">
                  <AlertTriangleIcon className="size-6 mr-2" />
                  Possible duplicate clips
                </span>
              )}
            </h1>
          </div>

          {!liveMediaStream && clips.length === 0 ? (
            <div className="w-full aspect-[16/9] bg-card rounded-lg flex flex-col items-center justify-center gap-3">
              <VideoOffIcon className="size-10 text-muted-foreground" />
              <p className="text-muted-foreground text-sm text-center px-4">
                No video stream or clips yet. Connect OBS to start recording.
              </p>
            </div>
          ) : (
            <>
              {liveMediaStream && (
                <div
                  className={cn(
                    "w-full h-full relative aspect-[16/9]",
                    isLiveStreamPortrait && "w-92 aspect-[9/16]",
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
                  "w-full aspect-[16/9]",
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
            </>
          )}

          {isOBSActive && (
            <div className="mt-2 flex justify-center">
              <PauseLengthToggle />
            </div>
          )}

          {currentClip?.type === "on-database" && (
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
              allClipsHaveSilenceDetected={allClipsHaveSilenceDetected}
              allClipsHaveText={allClipsHaveText}
              onExport={() => startExportUpload(videoId, videoPath)}
              exportToDavinciResolveFetcher={exportToDavinciResolveFetcher}
              videoId={videoId}
              lessonId={lessonId}
              isCopied={isCopied}
              copyTranscriptToClipboard={copyTranscriptToClipboard}
              youtubeChapters={youtubeChapters}
              isChaptersCopied={isChaptersCopied}
              copyYoutubeChaptersToClipboard={copyYoutubeChaptersToClipboard}
              onAddVideoClick={() => setIsAddVideoModalOpen(true)}
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
              onOpenInVSCode={
                lessonId
                  ? () => {
                      openInVSCodeFetcher.submit(
                        {},
                        {
                          method: "post",
                          action: `/api/videos/${videoId}/open-in-vscode`,
                        }
                      );
                    }
                  : undefined
              }
              isLogPathCopied={isLogPathCopied}
              copyLogPathToClipboard={copyLogPathToClipboard}
              referenceCandidates={referenceCandidates}
              referenceVideoId={referenceVideoId}
              setReferenceVideoId={setReferenceVideoId}
              onGenerateChaptersClick={onOpenGenerateChaptersModal}
              onOpenDiagramPlayground={handleOpenDiagramPlayground}
            />
            <Button variant="secondary" onClick={onAddNoteFromClipboard}>
              <ClipboardIcon className="w-4 h-4 mr-1" />
              Add Note
            </Button>
          </div>

          {/* Tabbed panel for Suggestions and Table of Contents */}
          <div className="mt-6 border-t border-border pt-4">
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setActiveTab("suggestions")}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded transition-colors",
                  activeTab === "suggestions"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Suggestions
              </button>
              {hasSections && (
                <button
                  onClick={() => setActiveTab("toc")}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded transition-colors",
                    activeTab === "toc"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Sections
                </button>
              )}
              <button
                onClick={() => setActiveTab("links")}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded transition-colors",
                  activeTab === "links"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                Links
              </button>
            </div>

            {activeTab === "suggestions" && (
              <Suspense>
                <DeferredSuggestionsPanel
                  fsData={fsData}
                  videoId={videoId}
                  lastTranscribedClipId={lastTranscribedClipId}
                  clips={clips}
                  insertionPoint={insertionPoint}
                  isStandalone={!lessonId}
                  onSuggestionStateChange={handleSuggestionStateChange}
                />
              </Suspense>
            )}

            {activeTab === "toc" && hasSections && (
              <TableOfContents
                chapters={chapters}
                selectedClipsSet={selectedClipsSet}
                onChapterClick={onChapterClick}
              />
            )}

            {activeTab === "links" && <VideoPlayerLinksTab />}
          </div>
        </div>
      </div>

      <Suspense>
        <DeferredAddVideoModal
          fsData={fsData}
          lessonId={lessonId}
          videoCount={videoCount}
          open={isAddVideoModalOpen}
          onOpenChange={setIsAddVideoModalOpen}
        />
      </Suspense>
    </>
  );
};

type FsData = Promise<{
  hasExplainerFolder: boolean;
  standaloneFiles: Array<{ path: string }>;
  files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
}>;

const DeferredSuggestionsPanel = (
  props: Omit<SuggestionsPanelProps, "files"> & { fsData: FsData }
) => {
  const { fsData: fsDataPromise, ...rest } = props;
  const fsData = use(fsDataPromise);
  return <SuggestionsPanel {...rest} files={fsData.files} />;
};

const DeferredAddVideoModal = (props: {
  fsData: FsData;
  lessonId?: string;
  videoCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { fsData: fsDataPromise, ...rest } = props;
  const fsData = use(fsDataPromise);
  return (
    <AddVideoModal {...rest} hasExplainerFolder={fsData.hasExplainerFolder} />
  );
};
