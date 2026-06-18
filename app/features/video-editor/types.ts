import type { FrontendId } from "./clip-state-reducer";
import type { OBSConnectionOuterState } from "./obs-connector";
import type { FrontendSpeechDetectorState } from "./use-speech-detector";

/**
 * State for the chapter naming modal.
 * Supports three modes:
 * - create: Creating a new section with a default name
 * - edit: Editing an existing section's name
 * - add-at: Adding a new section before or after an existing item
 */
export type ChapterNamingModal =
  | { mode: "create"; defaultName: string }
  | { mode: "edit"; chapterId: FrontendId; currentName: string }
  | {
      mode: "add-at";
      position: "before" | "after";
      itemId: FrontendId;
      defaultName: string;
    }
  | null;

/**
 * Map of clip frontendId to computed properties used for rendering.
 * - timecode: Display string for the clip's position in the video
 * - nextLevenshtein: Text similarity score to the next clip (0-100)
 */
export type ClipComputedProps = Map<
  FrontendId,
  { timecode: string; nextLevenshtein: number }
>;

/**
 * Props for the ChapterDivider component.
 * Renders a visual divider between chapters in the timeline.
 */
export type ChapterDividerProps = {
  name: string;
  isSelected: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onClick: (e: React.MouseEvent) => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * Props for the LiveMediaStream component.
 * Displays the live OBS/camera feed with speech detection indicators.
 */
export type LiveMediaStreamProps = {
  mediaStream: MediaStream;
  obsConnectorState: OBSConnectionOuterState;
  speechDetectorState: FrontendSpeechDetectorState;
  showCenterLine: boolean;
};
