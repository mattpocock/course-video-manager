import { ChapterNamingModal as ChapterNamingModalComponent } from "./components/chapter-naming-modal";
import { CreateVideoFromSelectionModal } from "./components/create-video-from-selection-modal";
import { FilePasteModalWithFsData } from "./components/file-paste-modal-with-fs-data";
import { VideoPlayerPanel } from "./components/video-player-panel";
import { ClipTimeline } from "./components/clip-timeline";
import { ErrorOverlay } from "./components/error-overlay";
import {
  ReferencePanel,
  type ReferenceCandidate,
} from "./components/reference-panel";
import { useGenerateChaptersModal } from "./hooks/use-generate-chapters-modal";
import {
  useDiagramPin,
  type UpdateClipDiagramPinFn,
} from "./hooks/use-diagram-pin";
import { useChapterModal } from "./hooks/use-chapter-modal";
import { useReferenceVideoId } from "./hooks/use-reference-video-id";
import { RenameVideoModal } from "@/components/rename-video-modal";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useWebSocket } from "./hooks/use-websocket";
import { useClipboardOperations } from "./hooks/use-clipboard-operations";
import {
  Suspense,
  useCallback,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { enableVideoEditorMode } from "@/lib/diagram-window";
import { useFetcher, useRevalidator } from "react-router";
import { useEffectReducer } from "use-effect-reducer";
import type {
  Clip,
  EditorError,
  FrontendId,
  FrontendInsertionPoint,
  RecordingSession,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer";
import { isClip } from "./clip-utils";
import { type OBSConnectionOuterState } from "./obs-connector";
import { type FrontendSpeechDetectorState } from "./use-speech-detector";
import type { PauseLength } from "@/silence-detection-constants";
import {
  makeVideoEditorReducer,
  type videoStateReducer,
} from "./video-state-reducer";
import {
  VideoEditorContext,
  type SuggestionState,
} from "./video-editor-context";
import {
  getClipsToAggressivelyPreload,
  getTotalDuration,
  getShowVideoPlayer,
  getShowLiveStream,
  getShowLastFrame,
  getDatabaseClipBeforeInsertionPoint,
  getTimelineItems,
  getSessionPanels,
  getCurrentClip,
  getAllClipsHaveSilenceDetected,
  getAllClipsHaveText,
  getClipComputedProps,
  getAreAnyClipsDangerous,
} from "./video-editor-selectors";

const useVideoEditor = (props: {
  items: TimelineItem[];
  clips: Clip[];
  insertionPoint: FrontendInsertionPoint;
  onClipsRemoved: (clipIds: FrontendId[]) => void;
  onClipsRetranscribe: (clipIds: FrontendId[]) => void;
  onToggleBeatForClip: (clipId: FrontendId) => void;
  onMoveClip: (clipId: FrontendId, direction: "up" | "down") => void;
  onAddChapter: (name: string) => void;
  onUpdateChapter: (chapterId: FrontendId, name: string) => void;
  onCreateVideoFromSelection: (
    clipIds: FrontendId[],
    chapterIds: FrontendId[],
    title: string,
    mode: "copy" | "move"
  ) => void;
}) => {
  const [state, dispatch] = useEffectReducer<
    videoStateReducer.State,
    videoStateReducer.Action,
    videoStateReducer.Effect
  >(
    makeVideoEditorReducer(
      props.items.map((item) => item.frontendId),
      props.clips.map((clip) => clip.frontendId)
    ),
    {
      showLastFrameOfVideo: true,
      runningState: "paused",
      currentClipId: props.clips[0]?.frontendId,
      currentTimeInClip: 0,
      selectedClipsSet: new Set<FrontendId>(),
      clipIdsPreloaded: new Set<FrontendId>(
        [props.clips[0]?.frontendId, props.clips[1]?.frontendId].filter(
          (id) => id !== undefined
        )
      ),
      playbackRate: 1,
      scrubSeekTime: undefined,
    },
    {
      "archive-clips": (_state, effect, _dispatch) => {
        props.onClipsRemoved(effect.clipIds);
      },
      "retranscribe-clips": (_state, effect, _dispatch) => {
        props.onClipsRetranscribe(effect.clipIds);
      },
      "toggle-beat-for-clip": (_state, effect, _dispatch) => {
        props.onToggleBeatForClip(effect.clipId);
      },
      "move-clip": (_state, effect, _dispatch) => {
        props.onMoveClip(effect.clipId, effect.direction);
      },
      "create-video-from-selection": (_state, effect, _dispatch) => {
        props.onCreateVideoFromSelection(
          effect.clipIds,
          effect.chapterIds,
          effect.title,
          effect.mode
        );
      },
    }
  );

  return {
    state,
    dispatch,
  };
};

export const VideoEditor = (props: {
  obsConnectorState: OBSConnectionOuterState;
  items: TimelineItem[];
  sessions: RecordingSession[];
  videoPath: string;
  lessonPath?: string;
  repoName?: string;
  repoId?: string;
  lessonId?: string;
  videoId: string;
  liveMediaStream: MediaStream | null;
  speechDetectorState: FrontendSpeechDetectorState;
  pauseLength: PauseLength;
  onPauseLengthChange: (pauseLength: PauseLength) => void;
  isRecordingActive: boolean;
  clipIdsBeingTranscribed: Set<FrontendId>;
  onClipsRemoved: (clipIds: FrontendId[]) => void;
  onClipsRetranscribe: (clipIds: FrontendId[]) => void;
  fsData: Promise<{
    hasExplainerFolder: boolean;
    standaloneFiles: Array<{ path: string }>;
    files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
  }>;
  videoCount: number;
  referenceCandidates: ReferenceCandidate[];
  onAddReferenceChapterAt: (input: {
    videoId: string;
    targetItemId: string;
    targetItemType: "clip" | "chapter";
    position: "before" | "after";
    name: string;
  }) => void;
  onEditReferenceChapterName: (chapterId: string, name: string) => void;
  onDeleteReferenceChapter: (chapterId: string) => void;
  onRegenerateChapters: (
    videoId: string,
    sections: Array<{ beforeClipId: string; title: string }>
  ) => Promise<void>;
  insertionPoint: FrontendInsertionPoint;
  onSetInsertionPoint: (mode: "after" | "before", clipId: FrontendId) => void;
  onDeleteLatestInsertedClip: () => void;
  onToggleBeat: () => void;
  onToggleBeatForClip: (clipId: FrontendId) => void;
  onMoveClip: (clipId: FrontendId, direction: "up" | "down") => void;
  onAddChapter: (name: string) => void;
  onUpdateChapter: (chapterId: FrontendId, name: string) => void;
  onAddChapterAt: (
    name: string,
    position: "before" | "after",
    itemId: FrontendId
  ) => void;
  onAddEffectClipAt: (
    effectType: "white-noise",
    position: "before" | "after",
    itemId: FrontendId
  ) => void;
  onRestoreClip: (clipId: FrontendId) => void;
  onPermanentlyRemoveArchived: (sessionId: SessionId) => void;
  onClearAllArchived: () => void;
  error: EditorError | null;
  onCreateVideoFromSelection: (
    clipIds: FrontendId[],
    chapterIds: FrontendId[],
    title: string,
    mode: "copy" | "move"
  ) => void;
  onUpdateClipDiagramPin: UpdateClipDiagramPinFn;
}) => {
  // Filter items for the main timeline (excludes optimistic clips and archived items)
  const timelineItems = useMemo(
    () => getTimelineItems(props.items),
    [props.items]
  );

  // Derive clips from timeline items for playback, timecodes, etc.
  const clips = useMemo(() => timelineItems.filter(isClip), [timelineItems]);

  // Derive session panel data for RecordingSessionPanel components
  const sessionPanels = useMemo(
    () => getSessionPanels(props.items, props.sessions),
    [props.items, props.sessions]
  );

  useEffect(() => enableVideoEditorMode(), []);

  const { state, dispatch } = useVideoEditor({
    items: timelineItems,
    clips: clips,
    insertionPoint: props.insertionPoint,
    onClipsRemoved: props.onClipsRemoved,
    onClipsRetranscribe: props.onClipsRetranscribe,
    onToggleBeatForClip: props.onToggleBeatForClip,
    onMoveClip: props.onMoveClip,
    onAddChapter: props.onAddChapter,
    onUpdateChapter: props.onUpdateChapter,
    onCreateVideoFromSelection: props.onCreateVideoFromSelection,
  });

  const clipsToAggressivelyPreload = getClipsToAggressivelyPreload(
    state.currentClipId,
    clips,
    state.selectedClipsSet
  );

  const currentClipId = state.currentClipId;

  const exportToDavinciResolveFetcher = useFetcher();
  const [isAddVideoModalOpen, setIsAddVideoModalOpen] = useState(false);
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isRenameVideoModalOpen, setIsRenameVideoModalOpen] = useState(false);
  const [isCreateVideoModalOpen, setIsCreateVideoModalOpen] = useState(false);
  const revalidator = useRevalidator();

  const {
    openForMain: onOpenGenerateChaptersModal,
    openForReference: onOpenGenerateForReference,
    modal: generateChaptersModal,
  } = useGenerateChaptersModal({
    mainVideoId: props.videoId,
    mainVideoPath: props.videoPath,
    clips,
    referenceCandidates: props.referenceCandidates,
    onRegenerateChapters: props.onRegenerateChapters,
  });

  // Suggestion state for sharing between SuggestionsPanel and ClipTimeline
  const [suggestionState, setSuggestionState] = useState<SuggestionState>({
    suggestionText: "",
    isStreaming: false,
    enabled: false,
    error: null,
    triggerSuggestion: () => {},
  });

  const {
    chapterNamingModal,
    setChapterNamingModal,
    generateDefaultChapterName,
    onEditChapter,
    onAddChapterBefore,
    onAddChapterAfter,
    onAddIntroChapter,
    onOpenCreateChapterModal,
  } = useChapterModal(
    timelineItems,
    state.selectedClipsSet,
    props.onAddChapter
  );

  const { onUnpinDiagram } = useDiagramPin(
    props.items,
    props.onUpdateClipDiagramPin
  );

  // Setup keyboard shortcuts
  useKeyboardShortcuts(dispatch);

  // Setup WebSocket connection for Stream Deck integration
  useWebSocket({
    dispatch,
    onDeleteLatestInsertedClip: props.onDeleteLatestInsertedClip,
    onToggleBeat: props.onToggleBeat,
    onClearAllArchived: props.onClearAllArchived,
    setChapterNamingModal,
    generateDefaultChapterName,
  });

  // Clipboard operations for transcript and YouTube chapters
  const {
    copyTranscriptToClipboard,
    copyYoutubeChaptersToClipboard,
    isCopied,
    isChaptersCopied,
    youtubeChapters,
  } = useClipboardOperations(timelineItems);

  const totalDuration = getTotalDuration(clips);

  const showVideoPlayer = getShowVideoPlayer(
    state.runningState,
    !!props.liveMediaStream
  );
  const showLiveStream = getShowLiveStream(
    !!props.liveMediaStream,
    state.runningState
  );
  const showLastFrame = getShowLastFrame(state.showLastFrameOfVideo);

  const databaseClipToShowLastFrameOf = getDatabaseClipBeforeInsertionPoint(
    timelineItems,
    props.insertionPoint
  );

  const currentClip = getCurrentClip(clips, currentClipId);

  const allClipsHaveSilenceDetected = getAllClipsHaveSilenceDetected(clips);

  const allClipsHaveText = getAllClipsHaveText(clips);

  const clipComputedProps = useMemo(() => getClipComputedProps(clips), [clips]);

  const areAnyClipsDangerous = getAreAnyClipsDangerous(clips);

  const handlePasteModalClose = (open: boolean) => {
    setIsPasteModalOpen(open);
    if (!open) {
      // Revalidate to refresh the file list
      revalidator.revalidate();
    }
  };

  const handleCreateVideoFromSelection = useCallback(
    (title: string, mode: "copy" | "move") => {
      dispatch({
        type: "create-video-from-selection-confirmed",
        title,
        mode,
      });
    },
    [dispatch]
  );

  const [referenceVideoId, setReferenceVideoId] = useReferenceVideoId(
    props.videoId
  );

  // Build context value with all state and callbacks
  const contextValue = useMemo(
    () => ({
      // From videoStateReducer
      runningState: state.runningState,
      currentClipId: state.currentClipId,
      currentTimeInClip: state.currentTimeInClip,
      selectedClipsSet: state.selectedClipsSet,
      clipIdsPreloaded: state.clipIdsPreloaded,
      playbackRate: state.playbackRate,
      showLastFrameOfVideo: state.showLastFrameOfVideo,
      scrubSeekTime: state.scrubSeekTime,
      dispatch,

      // Computed
      clips,
      currentClip,
      currentClipProfile: currentClip?.profile ?? undefined,
      showVideoPlayer,
      showLiveStream,
      showLastFrame,
      clipComputedProps,
      totalDuration,
      clipsToAggressivelyPreload,
      allClipsHaveText,
      allClipsHaveSilenceDetected,
      areAnyClipsDangerous,
      databaseClipToShowLastFrameOf,

      // Route-level props
      items: timelineItems,
      allItems: props.items,
      sessions: props.sessions,
      sessionPanels,
      videoPath: props.videoPath,
      videoId: props.videoId,
      repoName: props.repoName,
      lessonPath: props.lessonPath,
      repoId: props.repoId,
      lessonId: props.lessonId,
      fsData: props.fsData,
      videoCount: props.videoCount,
      referenceCandidates: props.referenceCandidates,
      referenceVideoId,
      setReferenceVideoId,
      insertionPoint: props.insertionPoint,
      obsConnectorState: props.obsConnectorState,
      liveMediaStream: props.liveMediaStream,
      speechDetectorState: props.speechDetectorState,
      pauseLength: props.pauseLength,
      setPauseLength: props.onPauseLengthChange,
      isRecordingActive: props.isRecordingActive,
      clipIdsBeingTranscribed: props.clipIdsBeingTranscribed,

      // Callbacks
      onSetInsertionPoint: props.onSetInsertionPoint,
      onMoveClip: props.onMoveClip,
      onToggleBeatForClip: props.onToggleBeatForClip,
      onAddChapter: props.onAddChapter,
      onUpdateChapter: props.onUpdateChapter,
      onAddChapterAt: props.onAddChapterAt,
      onAddEffectClipAt: props.onAddEffectClipAt,
      onRestoreClip: props.onRestoreClip,
      onPermanentlyRemoveArchived: props.onPermanentlyRemoveArchived,
      onClipFinished: () => {
        dispatch({ type: "clip-finished" });
      },
      onUpdateCurrentTime: (time: number) => {
        dispatch({ type: "update-clip-current-time", time });
      },
      onChapterClick: (chapterId: FrontendId, index: number) => {
        dispatch({
          type: "click-clip",
          clipId: chapterId,
          ctrlKey: false,
          shiftKey: false,
        });

        requestAnimationFrame(() => {
          const allChapters = document.querySelectorAll('[id^="chapter-"]');
          if (allChapters[index]) {
            allChapters[index].scrollIntoView({
              behavior: "instant",
              block: "center",
            });
          }
        });
      },
      onAddIntroChapter,
      onOpenCreateChapterModal,
      onEditChapter,
      onAddChapterBefore,
      onAddChapterAfter,
      generateDefaultChapterName,

      // Clipboard
      copyTranscriptToClipboard,
      copyYoutubeChaptersToClipboard,
      youtubeChapters,
      isCopied,
      isChaptersCopied,

      exportToDavinciResolveFetcher,
      isAddVideoModalOpen,
      setIsAddVideoModalOpen,
      onAddNoteFromClipboard: () => setIsPasteModalOpen(true),
      isRenameVideoModalOpen,
      setIsRenameVideoModalOpen,
      isCreateVideoModalOpen,
      setIsCreateVideoModalOpen,

      // Suggestion state for inline display
      suggestionState,
      setSuggestionState,

      onOpenGenerateChaptersModal,

      // Diagram pin
      onUnpinDiagram,
    }),
    [
      state,
      dispatch,
      clips,
      currentClip,
      showVideoPlayer,
      showLiveStream,
      showLastFrame,
      clipComputedProps,
      totalDuration,
      clipsToAggressivelyPreload,
      allClipsHaveText,
      allClipsHaveSilenceDetected,
      areAnyClipsDangerous,
      databaseClipToShowLastFrameOf,
      props.items,
      props.videoPath,
      props.videoId,
      props.repoName,
      props.lessonPath,
      props.repoId,
      props.lessonId,
      props.fsData,
      props.videoCount,
      props.referenceCandidates,
      referenceVideoId,
      setReferenceVideoId,
      props.insertionPoint,
      props.obsConnectorState,
      props.liveMediaStream,
      props.speechDetectorState,
      props.pauseLength,
      props.onPauseLengthChange,
      props.isRecordingActive,
      props.clipIdsBeingTranscribed,
      props.onSetInsertionPoint,
      props.onMoveClip,
      props.onToggleBeatForClip,
      props.onAddChapter,
      props.onUpdateChapter,
      props.onAddChapterAt,
      props.onAddEffectClipAt,
      props.onRestoreClip,
      props.onPermanentlyRemoveArchived,
      copyTranscriptToClipboard,
      copyYoutubeChaptersToClipboard,
      youtubeChapters,
      isCopied,
      isChaptersCopied,
      exportToDavinciResolveFetcher,
      isAddVideoModalOpen,
      setIsAddVideoModalOpen,
      isRenameVideoModalOpen,
      setIsRenameVideoModalOpen,
      isCreateVideoModalOpen,
      setIsCreateVideoModalOpen,
      suggestionState,
      setSuggestionState,
      onAddIntroChapter,
      onOpenCreateChapterModal,
      onEditChapter,
      onAddChapterBefore,
      onAddChapterAfter,
      generateDefaultChapterName,
      onOpenGenerateChaptersModal,
      onUnpinDiagram,
    ]
  );

  // Show error overlay if there's a fatal error
  if (props.error) {
    return <ErrorOverlay error={props.error} />;
  }

  const activeReference =
    referenceVideoId &&
    props.referenceCandidates.some((c) => c.id === referenceVideoId)
      ? referenceVideoId
      : null;

  const modals = (
    <>
      <ChapterNamingModalComponent
        modalState={chapterNamingModal}
        onClose={() => setChapterNamingModal(null)}
        onAddChapter={props.onAddChapter}
        onUpdateChapter={props.onUpdateChapter}
        onAddChapterAt={props.onAddChapterAt}
      />
      <Suspense>
        <FilePasteModalWithFsData
          fsData={props.fsData}
          lessonId={props.lessonId}
          videoId={props.videoId}
          isPasteModalOpen={isPasteModalOpen}
          handlePasteModalClose={handlePasteModalClose}
          handleFileCreated={() => {}}
        />
      </Suspense>
      <RenameVideoModal
        videoId={props.videoId}
        currentName={props.videoPath}
        open={isRenameVideoModalOpen}
        onOpenChange={setIsRenameVideoModalOpen}
      />
      <CreateVideoFromSelectionModal
        open={isCreateVideoModalOpen}
        onOpenChange={setIsCreateVideoModalOpen}
        onSubmit={handleCreateVideoFromSelection}
      />
      {generateChaptersModal}
    </>
  );

  const body: ReactNode = activeReference ? (
    <>
      <ClipTimeline />
      <div className="order-3 lg:order-2 lg:w-[40ch] shrink-0 h-full min-h-0">
        <ReferencePanel
          candidates={props.referenceCandidates}
          selectedId={activeReference}
          onRemove={() => setReferenceVideoId(null)}
          onAddChapterAt={props.onAddReferenceChapterAt}
          onEditChapterName={props.onEditReferenceChapterName}
          onDeleteChapter={props.onDeleteReferenceChapter}
          onGenerateChapters={() => onOpenGenerateForReference(activeReference)}
          className="h-full"
        />
      </div>
      <div className="order-1 lg:order-3 lg:flex-[1.5] h-full min-h-0 flex flex-col">
        <VideoPlayerPanel />
      </div>
    </>
  ) : (
    <>
      <VideoPlayerPanel />
      <ClipTimeline />
    </>
  );

  return (
    <div className="flex flex-col lg:flex-row h-full p-6 gap-6">
      <VideoEditorContext.Provider value={contextValue}>
        {body}
        {modals}
      </VideoEditorContext.Provider>
    </div>
  );
};
