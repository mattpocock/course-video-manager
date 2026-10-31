import type { FootageNotFound } from "@/services/clip-source-files.server";
import { EditorVideoMenuProvider } from "./editor-video-menu";
import { EditorModals } from "./components/editor-modals";
import { ErrorOverlay } from "./components/error-overlay";
import { type ReferenceCandidate } from "./components/reference-panel";
import { EditorSidePanel } from "./components/editor-side-panel";
import { useSuggestions } from "./hooks/use-suggestions";
import { useSubmitBeatEvent } from "./hooks/use-submit-beat-event";
import { useVideoEditor } from "./hooks/use-video-editor";
import { BEAT_TAB_STORAGE_KEY, BEAT_TABS, resolveBeatTab } from "./beat-tab";
import type { AnimaticLine } from "@/features/animatic/animatic-lines";
import type { BeatListBeat } from "@/features/beats/beat-list";
import { useAutofillChaptersModal } from "./hooks/use-autofill-chapters-modal";
import { useChapterModal } from "./hooks/use-chapter-modal";
import { getHasLivePreview } from "./live-preview";
import { useKeyboardShortcuts } from "./hooks/use-keyboard-shortcuts";
import { useTeleprompterEditorMode } from "./hooks/use-teleprompter-editor-mode";
import { toCaptureStatus } from "./recorder-capture";
import { useTeleprompterConnected } from "./hooks/use-teleprompter-connected";
import { useWebSocket } from "./hooks/use-websocket";
import { useClipboardOperations } from "./hooks/use-clipboard-operations";
import { useCallback, type ReactNode, useEffect, useMemo } from "react";
import { enableVideoEditorMode } from "@/lib/diagram-window";
import { useDiagramRecordingStatus } from "./use-diagram-recording-status";
import {
  useLocalStorage,
  useLocalStorageOneOf,
} from "@/hooks/use-local-storage";
import type {
  DatabaseId,
  EditorError,
  FrontendId,
  FrontendInsertionPoint,
  RecordingSession,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer";
import { isClip } from "./clip-utils";
import { type FrontendSpeechDetectorState } from "./speech-detector-reducer";
import type { SilenceLength } from "@/silence-detection-constants";
import {
  VideoEditorContext,
  type UpdateClipDiagramPinFn,
  type VideoEditorContextType,
} from "./video-editor-context";
import { useEditorModalsReducer } from "./hooks/use-editor-modals-reducer";
import type { VideoFormat } from "@/features/videos/video-format";
import type { ClipOverlay } from "./overlay-preview";
import { useOverlaysByClipId } from "./overlay-spill";
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
  isCaptureInProgress,
} from "./video-editor-selectors";

/** The parts of the editor a layout places. */
export type VideoEditorLayoutParts = {
  /** The Script, Beats, Reference, Animatic and Suggestions tabs. */
  sidePanel: ReactNode;
};

export type VideoEditorLayout = (parts: VideoEditorLayoutParts) => ReactNode;

export type VideoEditorProps = {
  videoFormat: VideoFormat;
  /**
   * Whether at least one of this Video's Clips has no Transcript Words —
   * computed by the loader, since word rows themselves never reach the client.
   */
  anyClipsMissingTranscriptWords: boolean;
  cvmRecorder: VideoEditorContextType["cvmRecorder"];
  calibrationGate: VideoEditorContextType["calibrationGate"];
  items: TimelineItem[];
  sessions: RecordingSession[];
  videoTitle: string;
  lessonPath?: string;
  repoName?: string;
  repoId?: string;
  lessonId?: string;
  /**
   * Lays the editor out. The edit route's is `EditorLayout`; another route may
   * supply its own, drawn from `VideoEditorContext`'s components.
   */
  layout: VideoEditorLayout;
  /**
   * Whether the layout plays Clips back. Without replay (the Streaming tab),
   * no editor key or teleprompter mark plays a Clip or edits the timeline.
   */
  replay: boolean;
  videoId: string;
  speechDetectorState: FrontendSpeechDetectorState;
  silenceLength: SilenceLength;
  onSilenceLengthChange: (silenceLength: SilenceLength) => void;
  isRecordingActive: boolean;
  onClipsRemoved: (clipIds: FrontendId[]) => void;
  onClipsRetranscribe: (clipIds: FrontendId[]) => void;
  fsData: Promise<{
    hasExplainerFolder: boolean;
    standaloneFiles: Array<{ path: string }>;
    files: Array<{ path: string; size: number; defaultEnabled: boolean }>;
  }>;
  /** Transcripts of the previous Video's Clips, for the Suggestions tab. */
  previousVideoClips: string[];
  videoCount: number;
  beats: BeatListBeat[];
  animatic: AnimaticLine[];
  /** Every Overlay on this Video — the loader's own read, no in-UI authoring. */
  overlays: ClipOverlay[];
  /**
   * Clips whose Footage is on no reachable Storage Root, by Clip database
   * id, with the message shown in place of the player.
   */
  footageNotFound: Record<string, FootageNotFound>;
  /** Does this video have a teleprompter script? Enables "Copy script". */
  hasScript: boolean;
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
  onAutofillChapters: (
    videoId: string,
    sections: Array<{ beforeClipId: string; title: string }>
  ) => Promise<void>;
  insertionPoint: FrontendInsertionPoint;
  onSetInsertionPoint: (mode: "after" | "before", clipId: FrontendId) => void;
  onDeleteLatestInsertedClip: () => void;
  onTogglePause: () => void;
  onTogglePauseForClip: (clipId: FrontendId) => void;
  onToggleZoomForClip: (clipId: FrontendId) => void;
  onEditClipText: VideoEditorContextType["onEditClipText"];
  onMoveClip: (clipId: FrontendId, direction: "up" | "down") => void;
  onAddChapter: (name: string) => void;
  onUpdateChapter: (chapterId: FrontendId, name: string) => void;
  onAddChapterAt: VideoEditorContextType["onAddChapterAt"];
  onAddEffectClipAt: VideoEditorContextType["onAddEffectClipAt"];
  onRestoreClip: (clipId: FrontendId) => void;
  onPermanentlyRemoveArchived: (scope: SessionId | "all") => void;
  error: EditorError | null;
  onCreateVideoFromSelection: (
    clipIds: FrontendId[],
    chapterIds: FrontendId[],
    title: string,
    mode: "copy" | "move"
  ) => void;
  onUpdateClipDiagramPin: UpdateClipDiagramPinFn;
  onRemoveWebLink: (clipId: FrontendId, linkId: DatabaseId) => void;
};

/**
 * The video editor's context, its Stream Deck, keyboard, teleprompter and
 * Suggestions wiring, and its dialogs, around a layout the caller supplies.
 */
export const VideoEditor = (props: VideoEditorProps) => {
  // Filter items for the main timeline (excludes optimistic clips and archived items)
  const timelineItems = useMemo(
    () => getTimelineItems(props.items),
    [props.items]
  );

  // Derive clips from timeline items for playback, timecodes, etc. This is also
  // exactly what a Copy Video duplicates — clips on the database that aren't on
  // their way to the archive — so its length is what the Copy Video modal shows.
  const clips = useMemo(() => timelineItems.filter(isClip), [timelineItems]);
  const overlaysByClipId = useOverlaysByClipId(clips, props.overlays);

  // Derive session panel data for RecordingSessionPanel components
  const sessionPanels = useMemo(
    () => getSessionPanels(props.items, props.sessions),
    [props.items, props.sessions]
  );

  useEffect(() => enableVideoEditorMode(), []);
  useDiagramRecordingStatus(props.isRecordingActive, props.videoFormat);

  const { state, dispatch } = useVideoEditor({
    items: timelineItems,
    allItems: props.items,
    clips: clips,
    insertionPoint: props.insertionPoint,
    onClipsRemoved: props.onClipsRemoved,
    onClipsRetranscribe: props.onClipsRetranscribe,
    onTogglePauseForClip: props.onTogglePauseForClip,
    onToggleZoomForClip: props.onToggleZoomForClip,
    onMoveClip: props.onMoveClip,
    onCreateVideoFromSelection: props.onCreateVideoFromSelection,
    onStopRecording: props.cvmRecorder.onStop,
    replay: props.replay,
  });

  const clipsToAggressivelyPreload = getClipsToAggressivelyPreload(
    state.currentClipId,
    clips,
    state.selectedClipsSet
  );

  const currentClipId = state.currentClipId;

  const {
    state: modalsState,
    dispatch: modalDispatch,
    onModalOpenChange,
  } = useEditorModalsReducer();

  const {
    openForMain: onOpenAutofillChaptersModal,
    openForReference: onOpenAutofillForReference,
    modal: autofillChaptersModal,
  } = useAutofillChaptersModal({
    mainVideoId: props.videoId,
    mainVideoTitle: props.videoTitle,
    clips,
    referenceCandidates: props.referenceCandidates,
    onAutofillChapters: props.onAutofillChapters,
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

  const onRemoveWebLink = props.onRemoveWebLink;

  useKeyboardShortcuts(dispatch);

  // Setup WebSocket connection for Stream Deck integration
  useWebSocket({
    dispatch,
    onDeleteLatestInsertedClip: props.onDeleteLatestInsertedClip,
    onTogglePause: props.onTogglePause,
    onPermanentlyRemoveArchived: props.onPermanentlyRemoveArchived,
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

  const hasLivePreview = getHasLivePreview(props.cvmRecorder.state);
  const showVideoPlayer = getShowVideoPlayer(
    state.runningState,
    hasLivePreview
  );
  const showLiveStream = getShowLiveStream(hasLivePreview, state.runningState);
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

  const [storedReferenceVideoId, setStoredReferenceVideoId] = useLocalStorage(
    `video-editor:reference:${props.videoId}`
  );
  const referenceVideoId = storedReferenceVideoId || null;

  // One choice for every Video: the next Video opens on the same tab.
  const [persistedBeatTab, setPersistedBeatTab] = useLocalStorageOneOf(
    BEAT_TAB_STORAGE_KEY,
    BEAT_TABS,
    "script"
  );

  const activeReference =
    referenceVideoId &&
    props.referenceCandidates.some((c) => c.id === referenceVideoId)
      ? referenceVideoId
      : null;

  const hasReference = activeReference !== null;
  const hasBeats = props.beats.length > 0;
  const hasAnimatic = props.animatic.length > 0;
  const activeTab = resolveBeatTab({
    persistedTab: persistedBeatTab,
    hasBeats,
    hasReference,
    hasAnimatic,
  });

  // Above the error-overlay early return, because these are hooks.
  // Suggestions run only while their tab is the one showing.
  const suggestions = useSuggestions({
    videoId: props.videoId,
    open: activeTab === "suggestions",
    animatic: props.animatic,
    beats: props.beats,
    items: timelineItems,
    insertionPoint: props.insertionPoint,
    fsData: props.fsData,
    previousVideoClips: props.previousVideoClips,
  });

  useTeleprompterEditorMode({
    videoId: props.videoId,
    capture: toCaptureStatus({
      isRecording: props.isRecordingActive,
      speech: props.speechDetectorState,
    }),
    items: props.items,
    sessions: props.sessions,
    playingClipId:
      state.runningState === "playing" ? (state.currentClipId ?? null) : null,
    suggestion: suggestions.teleprompterSuggestion,
    onClipMarkClicked: (clipId) =>
      dispatch({
        type: "click-teleprompter-mark",
        clipId: clipId as FrontendId,
      }),
  });

  const isTeleprompterConnected = useTeleprompterConnected();

  // Adding a reference auto-switches the persisted tab to Reference so the
  // newly-added reader surfaces; removing (next === null) leaves the tab alone.
  const handleSetReferenceVideoId = useCallback(
    (next: string | null) => {
      setStoredReferenceVideoId(next ?? "");
      if (next) setPersistedBeatTab("reference");
    },
    [setStoredReferenceVideoId, setPersistedBeatTab]
  );

  const submitBeatEvent = useSubmitBeatEvent();

  // The Beat Panel is read-only the instant a capture starts and through
  // the post-recording settling window (recording, polling, or unresolved
  // optimistic clips) — see isCaptureInProgress.
  const captureInProgress = isCaptureInProgress(props.items, props.sessions);

  const onShowBeatPanel = useCallback(
    () => setPersistedBeatTab("beats"),
    [setPersistedBeatTab]
  );

  const onShowScriptPanel = useCallback(
    () => setPersistedBeatTab("script"),
    [setPersistedBeatTab]
  );

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
      animatic: state.animatic,
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
      videoFormat: props.videoFormat,
      anyClipsMissingTranscriptWords: props.anyClipsMissingTranscriptWords,
      items: timelineItems,
      allItems: props.items,
      overlays: props.overlays,
      overlaysByClipId,
      footageNotFound: props.footageNotFound,
      sessions: props.sessions,
      sessionPanels,
      videoTitle: props.videoTitle,
      videoId: props.videoId,
      repoName: props.repoName,
      lessonPath: props.lessonPath,
      repoId: props.repoId,
      lessonId: props.lessonId,
      fsData: props.fsData,
      videoCount: props.videoCount,
      referenceCandidates: props.referenceCandidates,
      referenceVideoId,
      setReferenceVideoId: handleSetReferenceVideoId,
      hasBeats: props.beats.length > 0,
      onShowBeatPanel,
      onShowScriptPanel,
      insertionPoint: props.insertionPoint,
      cvmRecorder: props.cvmRecorder,
      calibrationGate: props.calibrationGate,
      speechDetectorState: props.speechDetectorState,
      silenceLength: props.silenceLength,
      setSilenceLength: props.onSilenceLengthChange,
      isRecordingActive: props.isRecordingActive,
      isTeleprompterConnected,

      // Callbacks
      onSetInsertionPoint: props.onSetInsertionPoint,
      onMoveClip: props.onMoveClip,
      onTogglePauseForClip: props.onTogglePauseForClip,
      onToggleZoomForClip: props.onToggleZoomForClip,
      onEditClipText: props.onEditClipText,
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

      // From editorModalsReducer
      openModal: modalsState.openModal,
      micSettingsClipId: modalsState.micSettingsClipId,
      editTranscriptClipId: modalsState.editTranscriptClipId,
      modalDispatch,
      onModalOpenChange,

      onOpenAutofillChaptersModal,

      onUpdateClipDiagramPin: props.onUpdateClipDiagramPin,

      // Web links
      onRemoveWebLink,
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
      props.videoFormat,
      props.anyClipsMissingTranscriptWords,
      props.items,
      props.overlays,
      overlaysByClipId,
      props.footageNotFound,
      props.videoTitle,
      props.videoId,
      props.repoName,
      props.lessonPath,
      props.repoId,
      props.lessonId,
      props.fsData,
      props.videoCount,
      props.referenceCandidates,
      referenceVideoId,
      handleSetReferenceVideoId,
      props.beats,
      onShowBeatPanel,
      onShowScriptPanel,
      props.insertionPoint,
      props.calibrationGate,
      props.speechDetectorState,
      props.silenceLength,
      props.onSilenceLengthChange,
      props.isRecordingActive,
      isTeleprompterConnected,
      props.onSetInsertionPoint,
      props.onMoveClip,
      props.onTogglePauseForClip,
      props.onToggleZoomForClip,
      props.onEditClipText,
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
      modalsState,
      modalDispatch,
      onModalOpenChange,
      onAddIntroChapter,
      onOpenCreateChapterModal,
      onEditChapter,
      onAddChapterBefore,
      onAddChapterAfter,
      generateDefaultChapterName,
      onOpenAutofillChaptersModal,
      props.onUpdateClipDiagramPin,
      onRemoveWebLink,
    ]
  );

  // Show error overlay if there's a fatal error
  if (props.error) {
    return <ErrorOverlay error={props.error} />;
  }

  const modals = (
    <EditorModals
      chapterNamingModal={chapterNamingModal}
      onCloseChapterNamingModal={() => setChapterNamingModal(null)}
      clipCount={clips.length}
      beatCount={props.beats.length}
      hasScript={props.hasScript}
      onCreateVideoFromSelection={handleCreateVideoFromSelection}
      autofillChaptersModal={autofillChaptersModal}
    />
  );

  const sidePanel: ReactNode = (
    <EditorSidePanel
      activeTab={activeTab}
      hasBeats={hasBeats}
      hasReference={hasReference}
      animatic={props.animatic}
      onTabChange={setPersistedBeatTab}
      videoId={props.videoId}
      beats={props.beats}
      isBeatsReadOnly={captureInProgress}
      onBeatEvent={submitBeatEvent}
      suggestions={suggestions}
      referenceCandidates={props.referenceCandidates}
      referenceVideoId={activeReference}
      onRemoveReference={() => handleSetReferenceVideoId(null)}
      onAddReferenceChapterAt={props.onAddReferenceChapterAt}
      onEditReferenceChapterName={props.onEditReferenceChapterName}
      onDeleteReferenceChapter={props.onDeleteReferenceChapter}
      onAutofillReferenceChapters={() => {
        if (activeReference) onOpenAutofillForReference(activeReference);
      }}
    />
  );

  return (
    <VideoEditorContext.Provider value={contextValue}>
      <EditorVideoMenuProvider>
        {props.layout({ sidePanel })}
        {modals}
      </EditorVideoMenuProvider>
    </VideoEditorContext.Provider>
  );
};
