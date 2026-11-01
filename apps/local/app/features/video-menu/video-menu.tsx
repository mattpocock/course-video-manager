import {
  bundle,
  type ActionLeaf,
  type ActionPicker,
  type ActionMenuGroups,
} from "@/features/action-menu/action-menu-model";
import { STANDARD_ACTIONS } from "@/features/action-menu/standard-actions";
import type { BeatKind } from "@/features/beats/beat-kinds";
import type { SilenceLength } from "@/silence-detection-constants";
import { beatKindLeaves } from "@/features/beats/beat-menu-items";
import {
  BookOpenIcon,
  Clapperboard,
  ClipboardCopy,
  ClipboardIcon,
  CodeIcon,
  FileText,
  FileX,
  FilmIcon,
  MonitorSpeaker,
  PlayIcon,
  Music2,
  RefreshCwIcon,
  ScrollText,
  ScrollTextIcon,
  SendIcon,
  Sparkles,
  TimerIcon,
  Workflow,
  XIcon,
  Youtube,
  type LucideIcon,
} from "lucide-react";

/** An action a surface offers: just the handler, or the handler plus why it is blocked. */
export type VideoAction =
  | (() => void)
  | { onSelect: () => void; disabled?: boolean; description?: string };

/**
 * Everything a Video's action menu can offer. Each surface passes the actions
 * that apply where it is (CODING_STANDARDS.md, "Action menus", rule 7): a
 * missing key hides the item. Labels, icons and groups live here alone, so the
 * course view, /videos, /shorts, the editor and the Video's breadcrumb cannot
 * drift apart again.
 */
export interface VideoMenuActions {
  // open
  openTeleprompter?: VideoAction;
  openDiagramPlayground?: VideoAction;
  /** Pick another Video to open alongside, or close the open one. */
  reference?:
    | {
        candidates: { id: string; title: string }[];
        open: (videoId: string) => void;
      }
    | { close: () => void };
  revealInFileSystem?: VideoAction;
  openInVSCode?: VideoAction;
  // edit
  rename?: VideoAction;
  editLessonBody?: VideoAction;
  editScript?: VideoAction;
  autofillDescription?: VideoAction;
  autofillChapters?: VideoAction;
  /** Only on an archived Video: puts it back where it was. */
  unarchive?: VideoAction;
  /** The next Recording Session's Silence Length. Fixed while one records. */
  silenceLength?: {
    value: SilenceLength;
    onValueChange: (value: SilenceLength) => void;
    disabled?: boolean;
  };
  // create
  addBeat?: (kind: BeatKind) => void;
  /** Opens the paste dialog that adds the clipboard to the Video as a note. */
  addNote?: VideoAction;
  duplicate?: VideoAction;
  addVideoToLesson?: VideoAction;
  /** Creates a Short and opens it, its back button returning here. */
  newShort?: VideoAction;
  // move
  moveToLesson?: VideoAction;
  moveToCourse?: VideoAction;
  // run
  export?: VideoAction;
  renderVerticalShort?: VideoAction;
  retranscribeAllClips?: VideoAction;
  postShort?: VideoAction;
  postToYouTube?: VideoAction;
  postToTikTok?: VideoAction;
  // copy
  copyTranscript?: VideoAction;
  copyYouTubeChapters?: VideoAction;
  copyLogPath?: VideoAction;
  // danger
  /** Confirms first: deletes the exported file from disk. */
  purgeExport?: VideoAction;
  /** Undoable (see `unarchive`), so it acts at once: archives the Video and its Clips. */
  archive?: VideoAction;
}

type LeafLook = Omit<ActionLeaf, "onSelect">;

function leaf(
  look: LeafLook,
  action: VideoAction | undefined
): ActionLeaf | false {
  if (!action) return false;
  if (typeof action === "function") return { ...look, onSelect: action };
  return {
    ...look,
    onSelect: action.onSelect,
    disabled: action.disabled,
    description: action.description,
  };
}

/**
 * The one Video action list. Render it with `EntityMenuContent` and
 * `entity={{ type: "video", id }}`. `groupRareActions` is for the video
 * editor, whose menu offers nearly everything: it keeps the actions used while
 * recording at the top level and folds the rest of each group into one
 * submenu (CODING_STANDARDS.md, "Action menus", rule 9).
 */
export function videoMenuGroups(
  a: VideoMenuActions,
  options: { groupRareActions?: boolean } = {}
): ActionMenuGroups {
  const fold = (
    label: string,
    icon: LucideIcon,
    items: (ActionLeaf | false)[]
  ) => (options.groupRareActions ? [bundle(label, icon, items)] : items);
  const reference = a.reference;
  return {
    open: [
      ...fold(STANDARD_ACTIONS.open.label, STANDARD_ACTIONS.open.icon, [
        leaf(
          { label: "Open Teleprompter", icon: MonitorSpeaker },
          a.openTeleprompter
        ),
        leaf(
          { label: "Open Diagram Playground", icon: Workflow },
          a.openDiagramPlayground
        ),
        leaf(STANDARD_ACTIONS.revealInFileSystem, a.revealInFileSystem),
        leaf({ label: "Open in VS Code", icon: CodeIcon }, a.openInVSCode),
      ]),
      reference &&
        ("close" in reference
          ? {
              label: "Close Reference",
              icon: XIcon,
              onSelect: reference.close,
            }
          : reference.candidates.length > 0 && {
              label: "Open Reference",
              icon: BookOpenIcon,
              items: reference.candidates.map((c) => ({
                label: c.title,
                icon: BookOpenIcon,
                onSelect: () => reference.open(c.id),
              })),
            }),
    ],
    edit: [
      ...fold(STANDARD_ACTIONS.edit.label, STANDARD_ACTIONS.edit.icon, [
        leaf({ ...STANDARD_ACTIONS.rename, opensDialog: true }, a.rename),
        leaf(
          { label: "Edit Lesson Body", icon: FileText, opensDialog: true },
          a.editLessonBody
        ),
        leaf(
          { label: "Edit Script", icon: ScrollText, opensDialog: true },
          a.editScript
        ),
        leaf(
          { label: "Autofill Description", icon: Sparkles, opensDialog: true },
          a.autofillDescription
        ),
        leaf(
          { label: "Autofill Chapters", icon: Sparkles, opensDialog: true },
          a.autofillChapters
        ),
        leaf(STANDARD_ACTIONS.unarchive, a.unarchive),
      ]),
      a.silenceLength && silenceLengthPicker(a.silenceLength),
    ],
    create: [
      a.addBeat && {
        ...STANDARD_ACTIONS.add,
        label: "Add Beat",
        items: beatKindLeaves(a.addBeat, { opensDialog: true }),
      },
      leaf(
        { label: "Add Note", icon: ClipboardIcon, opensDialog: true },
        a.addNote
      ),
      leaf({ label: "New Short", icon: Clapperboard }, a.newShort),
      ...fold("Create", STANDARD_ACTIONS.add.icon, [
        leaf({ ...STANDARD_ACTIONS.duplicate, opensDialog: true }, a.duplicate),
        leaf(
          {
            ...STANDARD_ACTIONS.add,
            label: "Add Video to Lesson",
            opensDialog: true,
          },
          a.addVideoToLesson
        ),
      ]),
    ],
    move: [
      leaf(
        {
          ...STANDARD_ACTIONS.moveTo,
          label: "Move to Lesson",
          opensDialog: true,
        },
        a.moveToLesson
      ),
      leaf(
        {
          ...STANDARD_ACTIONS.moveTo,
          label: "Move to Course",
          opensDialog: true,
        },
        a.moveToCourse
      ),
    ],
    run: [
      leaf(STANDARD_ACTIONS.export, a.export),
      leaf(
        { label: "Post Short", icon: SendIcon, opensDialog: true },
        a.postShort
      ),
      ...fold("Run", PlayIcon, [
        leaf(
          { label: "Post to YouTube", icon: Youtube, opensDialog: true },
          a.postToYouTube
        ),
        leaf(
          { label: "Post to TikTok", icon: Music2, opensDialog: true },
          a.postToTikTok
        ),
        leaf(
          { label: "Render Vertical Short", icon: FilmIcon },
          a.renderVerticalShort
        ),
        leaf(
          { label: "Re-transcribe All Clips", icon: RefreshCwIcon },
          a.retranscribeAllClips
        ),
      ]),
    ],
    copy: fold(STANDARD_ACTIONS.copy.label, STANDARD_ACTIONS.copy.icon, [
      leaf({ label: "Copy Transcript", icon: ClipboardCopy }, a.copyTranscript),
      leaf(
        { label: "Copy YouTube Chapters", icon: ClipboardCopy },
        a.copyYouTubeChapters
      ),
      leaf({ label: "Copy Log Path", icon: ScrollTextIcon }, a.copyLogPath),
    ]),
    danger: [
      leaf(
        { label: "Purge Export", icon: FileX, opensDialog: true },
        a.purgeExport
      ),
      leaf(STANDARD_ACTIONS.archive, a.archive),
    ],
  };
}

const SILENCE_LENGTH_OPTIONS: { value: SilenceLength; label: string }[] = [
  { value: "short", label: "Short" },
  { value: "long", label: "Long" },
];

/** A choice of value inside the menu, so a picker rather than a leaf. */
function silenceLengthPicker(
  s: NonNullable<VideoMenuActions["silenceLength"]>
): ActionPicker {
  return {
    label: "Set Silence Length",
    icon: TimerIcon,
    value: s.value,
    onValueChange: (value) => {
      if (value === "short" || value === "long") s.onValueChange(value);
    },
    options: SILENCE_LENGTH_OPTIONS.map((o) => ({
      ...o,
      disabled: s.disabled,
    })),
  };
}
