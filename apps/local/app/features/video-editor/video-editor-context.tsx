import type { FootageNotFound } from "@/services/clip-source-files.server";
import { createContext } from "use-context-selector";
import type {
  Clip,
  ClipOnDatabase,
  DatabaseId,
  FrontendId,
  FrontendInsertionPoint,
  RecordingSession,
  SessionId,
  TimelineItem,
} from "./clip-state-reducer";
import type { SessionPanelData } from "./video-editor-selectors";
import type { videoStateReducer } from "./video-state-reducer";
import type { editorModalsReducer } from "./editor-modals-reducer";
import type { OBSConnectionOuterState } from "./obs-connector";
import type { RecorderPicker } from "./use-recorder-choice";
import type { CvmRecorderControls } from "./use-cvm-recorder";
import type { CalibrationGate } from "./use-calibration-gate";
import type { FrontendSpeechDetectorState } from "./use-speech-detector";
import type { SilenceLength } from "@/silence-detection-constants";
import type { ClipComputedProps } from "./types";
import type { ReferenceCandidate } from "./components/reference-panel";
import type { VideoFormat } from "@/features/videos/video-format";
import type { ClipOverlay } from "./overlay-preview";

export type UpdateClipDiagramPinFn = (
  clipFrontendId: FrontendId,
  clipDatabaseId: string,
  diagramSnapshotId: string | null,
  diagramName: string | null
) => void;

export type FileMetadata = {
  path: string;
  size: number;
  defaultEnabled: boolean;
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
  videoFormat: VideoFormat;
  /** At least one Clip of this Video has no Transcript Words (#1571). */
  anyClipsMissingTranscriptWords: boolean;
  items: TimelineItem[];
  allItems: TimelineItem[];
  /** Every Overlay on this Video, across all of its Clips (see overlay-preview.tsx). */
  overlays: ClipOverlay[];
  /**
   * Every Overlay each Clip COVERS, keyed by Clip database id — wider than
   * `overlays` grouped by `clipId`, because an Overlay may outlive its anchor
   * Clip and keep covering the Clips that follow. See `overlay-spill.ts`.
   */
  overlaysByClipId: Map<string, ClipOverlay[]>;
  /**
   * Clips whose Footage is on no reachable Storage Root, by Clip database
   * id: "Footage not found (E: offline?): raw-footage/…".
   */
  footageNotFound: Record<string, FootageNotFound>;
  sessions: RecordingSession[];
  sessionPanels: SessionPanelData[];
  videoTitle: string;
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
  hasBeats: boolean;
  onShowBeatPanel: () => void;
  /** Activate the Script tab in the editor side panel. */
  onShowScriptPanel: () => void;
  insertionPoint: FrontendInsertionPoint;
  obsConnectorState: OBSConnectionOuterState;
  /** The Video's Recorder (OBS or CVM recorder), and the picker for it. */
  recorderPicker: RecorderPicker;
  /** Record and Stop on a CVM recorder Video. */
  cvmRecorder: CvmRecorderControls;
  /** Whether each Recorder may start, by the AV Calibration gate (ADR 0038). */
  calibrationGate: CalibrationGate;
  liveMediaStream: MediaStream | null;
  speechDetectorState: FrontendSpeechDetectorState;
  silenceLength: SilenceLength;
  setSilenceLength: (silenceLength: SilenceLength) => void;
  isRecordingActive: boolean;
  /** Is a teleprompter popup attached? Silences the live preview's capture status. */
  isTeleprompterConnected: boolean;

  // Callbacks
  onSetInsertionPoint: (mode: "after" | "before", clipId: FrontendId) => void;
  onMoveClip: (clipId: FrontendId, direction: "up" | "down") => void;
  onTogglePauseForClip: (clipId: FrontendId) => void;
  onToggleZoomForClip: (clipId: FrontendId) => void;
  /** Save a hand-edited text for a Clip (Edit Transcript, #2184). */
  onEditClipText: (clipId: FrontendId, text: string) => void;
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
  onAddIntroChapter: () => void;
  onOpenCreateChapterModal: () => void;
  onEditChapter: (chapterId: FrontendId, currentName: string) => void;
  onAddChapterBefore: (itemId: FrontendId, defaultName: string) => void;
  onAddChapterAfter: (itemId: FrontendId, defaultName: string) => void;
  generateDefaultChapterName: () => string;
  onRestoreClip: (clipId: FrontendId) => void;
  /**
   * A Recording Session's "Clear all": drops its archived and orphaned clips
   * from the panel. "all" does the same for every Recording Session at once.
   */
  onPermanentlyRemoveArchived: (scope: SessionId | "all") => void;

  // Clipboard
  copyTranscriptToClipboard: () => Promise<void>;
  copyYoutubeChaptersToClipboard: () => Promise<void>;
  youtubeChapters: { timestamp: string; name: string }[];
  isCopied: boolean;
  isChaptersCopied: boolean;

  // From editorModalsReducer: the open dialog
  openModal: editorModalsReducer.Modal | null;
  /** The CVM-recorder Clip the Mic Settings dialog is open on. */
  micSettingsClipId: FrontendId | null;
  /** The Clip the Edit Transcript dialog is open on. */
  editTranscriptClipId: FrontendId | null;
  modalDispatch: (action: editorModalsReducer.Action) => void;
  /** Each dialog's `onOpenChange`; stable, so a dialog may list it in an effect. */
  onModalOpenChange: Record<editorModalsReducer.Modal, (open: boolean) => void>;

  // AI Chapter generation
  onOpenAutofillChaptersModal: () => void;

  // Diagram pin; the editor unpins by passing nulls
  onUpdateClipDiagramPin: UpdateClipDiagramPinFn;

  // Web links captured during recording
  onRemoveWebLink: (clipId: FrontendId, linkId: DatabaseId) => void;
};

export const VideoEditorContext = createContext<VideoEditorContextType>(null!);
