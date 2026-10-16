import type { EffectReducer } from "use-effect-reducer";

/**
 * Which context goes with a writing request, and the context panel's file and
 * link dialogs. One reducer for the six places that pick context: the Article
 * Writer (`use-context-model.ts`) and the five posting routes
 * (`_app.videos.$videoId.{post,social,ai-hero,newsletter,skills-changelog}`).
 * See docs/FRONTEND_STATE.md.
 */
export namespace contextPanelReducer {
  /**
   * The source toggles the Article Writer remembers across pages. The posting
   * routes start from the defaults every time and never store them.
   */
  export type RememberedToggle =
    | "courseStructure"
    | "memory"
    | "beats"
    | "script"
    | "animatic"
    | "diagramText";

  /** What the Article Writer has stored; `null` on the posting routes. */
  export interface Remembered {
    courseStructure: boolean;
    memory: boolean;
    beats: boolean;
    script: boolean;
    animatic: boolean;
    diagramText: boolean;
    disabledLinks: Set<string>;
  }

  /** The posting routes' dialogs. Only one is open at a time. */
  export type Modal =
    "preview-file" | "add-link" | "edit-file" | "paste-file" | "delete-file";

  export interface State {
    enabledFiles: Set<string>;
    enabledSections: Set<string>;
    /** Other fields on the same page. Opt-in, so none start on. */
    enabledFields: Set<string>;
    /** The whole transcript, when the video has no chapters to pick from. */
    includeTranscript: boolean;
    includeCourseStructure: boolean;
    memoryEnabled: boolean;
    beatsEnabled: boolean;
    scriptEnabled: boolean;
    animaticEnabled: boolean;
    diagramTextEnabled: boolean;
    /**
     * Links default to on, so this tracks the ones switched off: a link added
     * after mount (by revalidation) is included.
     */
    disabledLinks: Set<string>;
    memoryText: string;
    /** Whether a toggle of a remembered source is stored. */
    remembers: boolean;

    openModal: Modal | null;
    /**
     * What each dialog is open on. Each outlives its dialog's close, so a
     * closing dialog keeps its content on screen while it animates out.
     */
    previewFilePath: string;
    editingFile: { path: string; content: string };
    fileToDelete: string;
    /** The file being read for the edit dialog; a read for another is late. */
    readingFilePath: string | null;
  }

  export type Action =
    // ── The posting routes' panel ─────────────────────────────────────────
    | { type: "sections-picked"; sectionIds: Set<string> }
    | { type: "files-picked"; paths: Set<string> }
    | { type: "transcript-checkbox-changed"; checked: boolean }
    | { type: "course-structure-checkbox-changed"; checked: boolean }
    // ── The Article Writer's context strip and context view ───────────────
    /**
     * A source's own checkbox. `itemIds` are the items it showed and
     * `atomic` whether it toggles as a whole.
     */
    | {
        type: "source-toggled";
        source: string;
        itemIds: string[];
        atomic: boolean;
      }
    /** One item's checkbox, inside the source it was shown in. */
    | { type: "item-toggled"; source: string; itemId: string; atomic: boolean }
    | { type: "memory-edited"; text: string }
    // ── The posting routes' dialogs ───────────────────────────────────────
    | { type: "file-clicked"; path: string }
    | { type: "edit-file-clicked"; videoId: string; path: string }
    | { type: "video-file-read"; path: string; content: string }
    | { type: "video-file-read-failed"; path: string }
    | { type: "delete-file-clicked"; path: string }
    | { type: "add-link-clicked" }
    | { type: "add-from-clipboard-clicked" }
    | { type: "file-pasted"; path: string }
    /** A dialog asked to close (Escape, overlay click, Cancel, or done). */
    | { type: "modal-dismissed"; modal: Modal };

  export type Effect =
    | { type: "store-toggle"; toggle: RememberedToggle; on: boolean }
    | { type: "store-disabled-links"; linkIds: string[] }
    | { type: "read-video-file"; videoId: string; path: string };
}

export const createInitialContextPanelState = (input: {
  files: Array<{ path: string; defaultEnabled: boolean }>;
  chapters: Array<{ id: string }>;
  memory?: string;
  remembered?: contextPanelReducer.Remembered | null;
}): contextPanelReducer.State => {
  const remembered = input.remembered ?? null;
  return {
    enabledFiles: new Set(
      input.files.filter((f) => f.defaultEnabled).map((f) => f.path)
    ),
    enabledSections: new Set(input.chapters.map((ch) => ch.id)),
    enabledFields: new Set(),
    includeTranscript: true,
    includeCourseStructure: remembered?.courseStructure ?? false,
    memoryEnabled: remembered?.memory ?? false,
    beatsEnabled: remembered?.beats ?? false,
    // Scripts are rare but high-value, so default to on wherever one exists.
    scriptEnabled: remembered?.script ?? true,
    // The pre-filming plan plus the author's own Clip Mockup Comments.
    animaticEnabled: remembered?.animatic ?? true,
    // Diagram-heavy videos say little that the diagram doesn't show.
    diagramTextEnabled: remembered?.diagramText ?? true,
    disabledLinks: remembered?.disabledLinks ?? new Set(),
    memoryText: input.memory ?? "",
    remembers: remembered !== null,
    openModal: null,
    previewFilePath: "",
    editingFile: { path: "", content: "" },
    fileToDelete: "",
    readingFilePath: null,
  };
};

const REMEMBERED_FIELD = {
  courseStructure: "includeCourseStructure",
  memory: "memoryEnabled",
  beats: "beatsEnabled",
  script: "scriptEnabled",
  animatic: "animaticEnabled",
  diagramText: "diagramTextEnabled",
} as const satisfies Record<
  contextPanelReducer.RememberedToggle,
  keyof contextPanelReducer.State
>;

const isRememberedToggle = (
  source: string
): source is contextPanelReducer.RememberedToggle =>
  Object.hasOwn(REMEMBERED_FIELD, source);

const toggled = (set: Set<string>, id: string): Set<string> => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

type Exec = Parameters<
  EffectReducer<
    contextPanelReducer.State,
    contextPanelReducer.Action,
    contextPanelReducer.Effect
  >
>[2];

const setRemembered = (
  state: contextPanelReducer.State,
  toggle: contextPanelReducer.RememberedToggle,
  on: boolean,
  exec: Exec
): contextPanelReducer.State => {
  if (state.remembers) exec({ type: "store-toggle", toggle, on });
  return { ...state, [REMEMBERED_FIELD[toggle]]: on };
};

const setDisabledLinks = (
  state: contextPanelReducer.State,
  disabledLinks: Set<string>,
  exec: Exec
): contextPanelReducer.State => {
  if (state.remembers) {
    exec({ type: "store-disabled-links", linkIds: [...disabledLinks] });
  }
  return { ...state, disabledLinks };
};

/** Every id on when any is off, else none. */
const allOrNone = (enabled: Set<string>, itemIds: string[]): Set<string> =>
  itemIds.every((id) => enabled.has(id)) ? new Set() : new Set(itemIds);

export const contextPanelReducer: EffectReducer<
  contextPanelReducer.State,
  contextPanelReducer.Action,
  contextPanelReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "sections-picked":
      return { ...state, enabledSections: action.sectionIds };
    case "files-picked":
      return { ...state, enabledFiles: action.paths };
    case "transcript-checkbox-changed":
      return { ...state, includeTranscript: action.checked };
    case "course-structure-checkbox-changed":
      return setRemembered(state, "courseStructure", action.checked, exec);

    case "source-toggled": {
      const { source, itemIds } = action;
      if (source === "transcript") {
        if (action.atomic) {
          return { ...state, includeTranscript: !state.includeTranscript };
        }
        return {
          ...state,
          enabledSections: allOrNone(state.enabledSections, itemIds),
        };
      }
      if (source === "files") {
        return {
          ...state,
          enabledFiles: allOrNone(state.enabledFiles, itemIds),
        };
      }
      if (source === "fields") {
        return {
          ...state,
          enabledFields: allOrNone(state.enabledFields, itemIds),
        };
      }
      if (source === "links") {
        const allOn = itemIds.every((id) => !state.disabledLinks.has(id));
        return setDisabledLinks(
          state,
          allOn ? new Set(itemIds) : new Set(),
          exec
        );
      }
      if (isRememberedToggle(source)) {
        return setRemembered(
          state,
          source,
          !state[REMEMBERED_FIELD[source]],
          exec
        );
      }
      return state;
    }

    case "item-toggled": {
      const { source, itemId } = action;
      if (source === "transcript") {
        if (action.atomic) {
          return { ...state, includeTranscript: !state.includeTranscript };
        }
        return {
          ...state,
          enabledSections: toggled(state.enabledSections, itemId),
        };
      }
      if (source === "files") {
        return { ...state, enabledFiles: toggled(state.enabledFiles, itemId) };
      }
      if (source === "fields") {
        return {
          ...state,
          enabledFields: toggled(state.enabledFields, itemId),
        };
      }
      if (source === "links") {
        return setDisabledLinks(
          state,
          toggled(state.disabledLinks, itemId),
          exec
        );
      }
      if (isRememberedToggle(source)) {
        return setRemembered(
          state,
          source,
          !state[REMEMBERED_FIELD[source]],
          exec
        );
      }
      return state;
    }

    case "memory-edited":
      return { ...state, memoryText: action.text };

    case "file-clicked":
      return {
        ...state,
        openModal: "preview-file",
        previewFilePath: action.path,
      };
    case "edit-file-clicked":
      exec({
        type: "read-video-file",
        videoId: action.videoId,
        path: action.path,
      });
      return { ...state, readingFilePath: action.path };
    case "video-file-read":
      // Only the file clicked last opens; an earlier read that lands late
      // must not replace it.
      if (state.readingFilePath !== action.path) return state;
      return {
        ...state,
        readingFilePath: null,
        openModal: "edit-file",
        editingFile: { path: action.path, content: action.content },
      };
    case "video-file-read-failed":
      if (state.readingFilePath !== action.path) return state;
      return { ...state, readingFilePath: null };
    case "delete-file-clicked":
      return { ...state, openModal: "delete-file", fileToDelete: action.path };
    case "add-link-clicked":
      return { ...state, openModal: "add-link" };
    case "add-from-clipboard-clicked":
      return { ...state, openModal: "paste-file" };
    case "file-pasted":
      // A pasted file is context the author wants, so it starts on.
      return {
        ...state,
        enabledFiles: new Set([...state.enabledFiles, action.path]),
      };
    case "modal-dismissed":
      // A late close from a dialog that has already been replaced must not
      // shut the one now on screen.
      if (state.openModal !== action.modal) return state;
      return { ...state, openModal: null };
  }
};
