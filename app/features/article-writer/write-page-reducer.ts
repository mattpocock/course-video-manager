import type { Mode, Model } from "./types";
import {
  MODE_STORAGE_KEY,
  MODEL_STORAGE_KEY,
  COURSE_STRUCTURE_STORAGE_KEY,
  MEMORY_ENABLED_STORAGE_KEY,
} from "./write-utils";

// ─── State ───────────────────────────────────────────────────────────────────

export interface WritePageState {
  mode: Mode;
  model: Model;
  enabledFiles: Set<string>;
  includeTranscript: boolean;
  enabledSections: Set<string>;
  includeCourseStructure: boolean;
  memory: string;
  memoryEnabled: boolean;
  docCapturingKey: string | null;
  isCopied: boolean;
  isAddVideoToNextLessonModalOpen: boolean;
  isFileModalOpen: boolean;
  selectedFilename: string;
  selectedFileContent: string;
  isPasteModalOpen: boolean;
  isDeleteModalOpen: boolean;
  fileToDelete: string;
  isLessonPasteModalOpen: boolean;
  isPreviewModalOpen: boolean;
  previewFilePath: string;
  isBannedPhrasesModalOpen: boolean;
  isAddLinkModalOpen: boolean;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type WritePageAction =
  | { type: "set-mode"; mode: Mode }
  | { type: "set-model"; model: Model }
  | { type: "set-enabled-files"; files: Set<string> }
  | { type: "add-enabled-file"; filename: string }
  | {
      type: "files-loaded";
      files: Array<{ path: string; defaultEnabled: boolean }>;
    }
  | { type: "set-include-transcript"; value: boolean }
  | { type: "set-enabled-sections"; sections: Set<string> }
  | { type: "set-include-course-structure"; value: boolean }
  | { type: "set-memory"; memory: string }
  | { type: "set-memory-enabled"; value: boolean }
  | { type: "set-doc-capturing-key"; key: string | null }
  | { type: "set-is-copied"; value: boolean }
  | { type: "set-add-video-modal-open"; value: boolean }
  | {
      type: "open-file-modal";
      filename: string;
      content: string;
    }
  | { type: "close-file-modal" }
  | { type: "set-paste-modal-open"; value: boolean }
  | { type: "open-delete-modal"; filename: string }
  | { type: "close-delete-modal" }
  | { type: "set-lesson-paste-modal-open"; value: boolean }
  | { type: "open-preview-modal"; filePath: string }
  | { type: "close-preview-modal" }
  | { type: "set-banned-phrases-modal-open"; value: boolean }
  | { type: "set-add-link-modal-open"; value: boolean };

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function writePageReducer(
  state: WritePageState,
  action: WritePageAction
): WritePageState {
  switch (action.type) {
    case "set-mode": {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(MODE_STORAGE_KEY, action.mode);
      }
      return { ...state, mode: action.mode };
    }
    case "set-model": {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(MODEL_STORAGE_KEY, action.model);
      }
      return { ...state, model: action.model };
    }
    case "set-enabled-files":
      return { ...state, enabledFiles: action.files };
    case "files-loaded": {
      const { files } = action;
      const enabledFiles =
        state.mode === "style-guide-skill-building"
          ? new Set(
              files
                .filter((f) => f.path.toLowerCase().endsWith("readme.md"))
                .map((f) => f.path)
            )
          : new Set(files.filter((f) => f.defaultEnabled).map((f) => f.path));
      return { ...state, enabledFiles };
    }
    case "add-enabled-file":
      return {
        ...state,
        enabledFiles: new Set([...state.enabledFiles, action.filename]),
      };
    case "set-include-transcript":
      return { ...state, includeTranscript: action.value };
    case "set-enabled-sections":
      return { ...state, enabledSections: action.sections };
    case "set-include-course-structure": {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(
          COURSE_STRUCTURE_STORAGE_KEY,
          String(action.value)
        );
      }
      return { ...state, includeCourseStructure: action.value };
    }
    case "set-memory":
      return { ...state, memory: action.memory };
    case "set-memory-enabled": {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(MEMORY_ENABLED_STORAGE_KEY, String(action.value));
      }
      return { ...state, memoryEnabled: action.value };
    }
    case "set-doc-capturing-key":
      return { ...state, docCapturingKey: action.key };
    case "set-is-copied":
      return { ...state, isCopied: action.value };
    case "set-add-video-modal-open":
      return { ...state, isAddVideoToNextLessonModalOpen: action.value };
    case "open-file-modal":
      return {
        ...state,
        isFileModalOpen: true,
        selectedFilename: action.filename,
        selectedFileContent: action.content,
      };
    case "close-file-modal":
      return { ...state, isFileModalOpen: false };
    case "set-paste-modal-open":
      return { ...state, isPasteModalOpen: action.value };
    case "open-delete-modal":
      return {
        ...state,
        isDeleteModalOpen: true,
        fileToDelete: action.filename,
      };
    case "close-delete-modal":
      return { ...state, isDeleteModalOpen: false };
    case "set-lesson-paste-modal-open":
      return { ...state, isLessonPasteModalOpen: action.value };
    case "open-preview-modal":
      return {
        ...state,
        isPreviewModalOpen: true,
        previewFilePath: action.filePath,
      };
    case "close-preview-modal":
      return {
        ...state,
        isPreviewModalOpen: false,
        previewFilePath: "",
      };
    case "set-banned-phrases-modal-open":
      return { ...state, isBannedPhrasesModalOpen: action.value };
    case "set-add-link-modal-open":
      return { ...state, isAddLinkModalOpen: action.value };
  }
}

// ─── Initial State ───────────────────────────────────────────────────────────

export function createInitialState({
  files,
  chapters,
  initialMemory,
}: {
  files: Array<{ path: string; defaultEnabled: boolean }>;
  chapters: Array<{ id: string }>;
  initialMemory: string;
}): WritePageState {
  const mode: Mode =
    typeof localStorage !== "undefined"
      ? (localStorage.getItem(MODE_STORAGE_KEY) as Mode) || "article"
      : "article";

  const model: Model =
    typeof localStorage !== "undefined"
      ? (localStorage.getItem(MODEL_STORAGE_KEY) as Model) || "claude-haiku-4-5"
      : "claude-haiku-4-5";

  const enabledFiles =
    mode === "style-guide-skill-building"
      ? new Set(
          files
            .filter((f) => f.path.toLowerCase().endsWith("readme.md"))
            .map((f) => f.path)
        )
      : new Set(files.filter((f) => f.defaultEnabled).map((f) => f.path));

  const includeCourseStructure =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(COURSE_STRUCTURE_STORAGE_KEY) === "true"
      : false;

  const memoryEnabled =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(MEMORY_ENABLED_STORAGE_KEY) === "true"
      : false;

  return {
    mode,
    model,
    enabledFiles,
    includeTranscript: true,
    enabledSections: new Set(chapters.map((s) => s.id)),
    includeCourseStructure,
    memory: initialMemory,
    memoryEnabled,
    docCapturingKey: null,
    isCopied: false,
    isAddVideoToNextLessonModalOpen: false,
    isFileModalOpen: false,
    selectedFilename: "",
    selectedFileContent: "",
    isPasteModalOpen: false,
    isDeleteModalOpen: false,
    fileToDelete: "",
    isLessonPasteModalOpen: false,
    isPreviewModalOpen: false,
    previewFilePath: "",
    isBannedPhrasesModalOpen: false,
    isAddLinkModalOpen: false,
  };
}
