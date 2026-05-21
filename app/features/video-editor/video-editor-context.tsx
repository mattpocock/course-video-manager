import { createContext } from "use-context-selector";
import type {
  Clip,
  ClipOnDatabase,
  FrontendId,
  FrontendInsertionPoint,
  RecordingSession,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer";
import type { SessionPanelData } from "./video-editor-selectors";
import type { videoStateReducer } from "./video-state-reducer";
import type { OBSConnectionOuterState } from "./obs-connector";
import type { FrontendSpeechDetectorState } from "./use-speech-detector";
import type { PauseLength } from "@/silence-detection-constants";
import type { ClipComputedProps } from "./types";
import type { ReferenceCandidate } from "./components/reference-panel";
import type { FetcherWithComponents } from "react-router";

export type FileMetadata = {
  path: string;
  size: number;
  defaultEnabled: boolean;
};

export type SuggestionState = {
  suggestionText: string;
  isStreaming: boolean;
  enabled: boolean;
  error: Error | null;
  triggerSuggestion: () => void;
};

export type VideoEditorContextType = {
  // From videoStateReducer
  runningState: "playing" | "paused";
  currentClipId: FrontendId | undefined;
  currentTimeInClip: number;
  selectedClipsSet: Set<FrontendId>;
  clipIdsPreloaded: Set<FrontendId>;
  playbackRate: number;
  showLastFrameOfVideo: boolean;
  scrubSeekTime: number | undefined;
  dispatch: (action: videoStateReducer.Action) => void;

  // Computed
  clips: Clip[];
  currentClip: Clip | undefined;
  currentClipProfile: string | undefined;
  showVideoPlayer: boolean;
  showLiveStream: boolean;
  showLastFrame: boolean;
  clipComputedProps: ClipComputedProps;
  totalDuration: number;
  clipsToAggressivelyPreload: FrontendId[];
  allClipsHaveText: boolean;
  allClipsHaveSilenceDetected: boolean;
  areAnyClipsDangerous: boolean;
  databaseClipToShowLastFrameOf: ClipOnDatabase | undefined;

  // Route-level props
  items: TimelineItem[];
  allItems: TimelineItem[];
  sessions: RecordingSession[];
  sessionPanels: SessionPanelData[];
  videoPath: string;
  videoId: string;
  repoName?: string;
  lessonPath?: string;
  repoId?: string;
  lessonId?: string;
  fsData: Promise<{
    hasExplainerFolder: boolean;
    standaloneFiles: Array<{ path: string }>;
    files: FileMetadata[];
  }>;
  videoCount: number;
  referenceCandidates: ReferenceCandidate[];
  referenceVideoId: string | null;
  setReferenceVideoId: (id: string | null) => void;
  insertionPoint: FrontendInsertionPoint;
  obsConnectorState: OBSConnectionOuterState;
  liveMediaStream: MediaStream | null;
  speechDetectorState: FrontendSpeechDetectorState;
  pauseLength: PauseLength;
  setPauseLength: (pauseLength: PauseLength) => void;
  isRecordingActive: boolean;
  clipIdsBeingTranscribed: Set<FrontendId>;

  // Callbacks
  onSetInsertionPoint: (mode: "after" | "before", clipId: FrontendId) => void;
  onMoveClip: (clipId: FrontendId, direction: "up" | "down") => void;
  onToggleBeatForClip: (clipId: FrontendId) => void;
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
  onClipFinished: () => void;
  onUpdateCurrentTime: (time: number) => void;
  onChapterClick: (chapterId: FrontendId, index: number) => void;
  onAddIntroChapter: () => void;
  onOpenCreateChapterModal: () => void;
  onEditChapter: (chapterId: FrontendId, currentName: string) => void;
  onAddChapterBefore: (itemId: FrontendId, defaultName: string) => void;
  onAddChapterAfter: (itemId: FrontendId, defaultName: string) => void;
  generateDefaultChapterName: () => string;
  onRestoreClip: (clipId: FrontendId) => void;
  onPermanentlyRemoveArchived: (sessionId: SessionId) => void;

  // Clipboard
  copyTranscriptToClipboard: () => Promise<void>;
  copyYoutubeChaptersToClipboard: () => Promise<void>;
  youtubeChapters: { timestamp: string; name: string }[];
  isCopied: boolean;
  isChaptersCopied: boolean;

  // Modal state (local useState, passed through context for access)
  exportToDavinciResolveFetcher: FetcherWithComponents<unknown>;
  isAddVideoModalOpen: boolean;
  setIsAddVideoModalOpen: (value: boolean) => void;
  onAddNoteFromClipboard: () => void;
  isRenameVideoModalOpen: boolean;
  setIsRenameVideoModalOpen: (value: boolean) => void;
  isCreateVideoModalOpen: boolean;
  setIsCreateVideoModalOpen: (value: boolean) => void;

  // Suggestion state for inline display
  suggestionState: SuggestionState;
  setSuggestionState: (state: SuggestionState) => void;

  // AI Chapter generation
  onOpenGenerateChaptersModal: () => void;

  // Diagram pin
  onUnpinDiagram: (clipId: FrontendId) => void;
};

export const VideoEditorContext = createContext<VideoEditorContextType>(null!);
