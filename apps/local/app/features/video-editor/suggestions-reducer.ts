/**
 * The Video Editor's **Suggestions** tab: what to say in the next Clip,
 * streamed from the model and mirrored onto the teleprompter.
 *
 * The rules, all decided here:
 *
 *   - Nothing runs unless the tab is open. The Script is loaded when the
 *     editor opens (the editor's loader leaves the Script text out), so
 *     opening the tab asks at once. It reloads the Script too, in case it was
 *     edited in the Script tab, and asks again if it changed.
 *   - Any change to what a suggestion is made from asks again AT ONCE, with
 *     no wait: a new Clip's transcript, a Clip deleted, moved or re-transcribed,
 *     the Insertion Point moved, the Animatic or Beats changed, a source
 *     ticked or unticked, or Refresh. The one exception is the author's
 *     Notes, which ask once typing pauses for a second.
 *   - A newer request stops the one in flight: only the newest suggestion
 *     ever shows.
 *   - Closing the tab stops the stream and forgets the suggestion, so the
 *     teleprompter goes back to the Script.
 *
 * Which sources are ticked is one global choice, not one per Video. A ticked
 * source this Video doesn't have is simply not sent; the tick is kept.
 *
 * The **Notes** are the fourth source: free text the author writes for this
 * Video only (how today's take will depart from the Script or Animatic). They
 * live in localStorage per Video, never the database, and outrank the other
 * sources in the prompt.
 *
 * The **repo files** are picked one by one in the Context modal, from the
 * Video's own files (the Article Writer's `FileTree`). The pick is kept per
 * Video in localStorage like the Notes, and ranks just below them. The
 * request names the picked paths; the route reads them. Changing the pick
 * asks again at once. A picked file the Video no longer has is not sent, but
 * stays picked.
 */
import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import {
  MOST_RECENT_CLIP_COUNT,
  type SuggestNextClipInput,
} from "@/prompts/generate-suggest-next-clip";
import { closeOpenBold } from "@/lib/close-open-bold";

export namespace suggestionsReducer {
  export type Source = "notes" | "script" | "animatic" | "beats";
  export const SOURCES: readonly Source[] = [
    "notes",
    "script",
    "animatic",
    "beats",
  ];
  export type Included = Record<Source, boolean>;

  /** Everything the editor knows that a suggestion is made from. */
  export type EditorContext = {
    /** The Animatic as text; empty when the Video has none. */
    animatic: string;
    /** The Beats as text; empty when the Video has none. */
    beats: string;
    /** Transcripts of every Clip before the Insertion Point, oldest first. */
    clips: string[];
    /** Every Clip whose transcript has arrived, so a new one is noticed. */
    transcribedClipIds: string[];
  };

  export type Status = "idle" | "waiting" | "streaming" | "done" | "failed";

  /** One of the Video's files the Context modal offers. */
  export type RepoFile = { path: string; size: number };

  export interface State {
    videoId: string;
    open: boolean;
    included: Included;
    /** `null` until the first load comes back. */
    script: string | null;
    /** This Video's Notes, as typed. */
    notes: string;
    /** The Video's files the Context modal offers; images are left out. */
    repoFiles: RepoFile[];
    /** The repo file paths the author picked for this Video. */
    pickedFiles: string[];
    /** Whether the Context modal is showing. */
    contextModalOpen: boolean;
    /** The pause after the last Notes edit, before asking again. */
    notesPause: EffectEntity<State, Action> | null;
    /** Which Notes edit the running pause is for; an older one is late. */
    notesEditId: number;
    context: EditorContext;
    status: Status;
    /** The suggestion so far. */
    text: string;
    /** The request whose text is showing; outcomes for any other are late. */
    requestId: number | null;
    nextRequestId: number;
    stream: EffectEntity<State, Action> | null;
  }

  export type Action =
    | { type: "suggestions-tab-opened" }
    | { type: "suggestions-tab-closed" }
    | { type: "script-loaded"; videoId: string; script: string }
    | { type: "editor-context-changed"; context: EditorContext }
    | { type: "source-toggled"; source: Source }
    | { type: "refresh-clicked" }
    | { type: "notes-edited"; notes: string }
    | { type: "notes-pause-elapsed"; editId: number }
    | { type: "repo-files-listed"; videoId: string; files: RepoFile[] }
    | { type: "context-button-clicked" }
    | { type: "context-modal-dismissed" }
    | { type: "repo-files-picked"; paths: string[] }
    | { type: "suggestion-chunk-received"; requestId: number; text: string }
    | { type: "suggestion-finished"; requestId: number }
    | { type: "suggestion-failed"; requestId: number };

  export type Effect =
    | { type: "load-script"; videoId: string }
    | {
        type: "stream-suggestion";
        requestId: number;
        videoId: string;
        input: SuggestNextClipInput;
      }
    | { type: "store-included-sources"; included: Included }
    | { type: "store-notes"; videoId: string; notes: string }
    | { type: "store-picked-files"; videoId: string; paths: string[] }
    | { type: "wait-for-notes-pause"; editId: number };
}

type State = suggestionsReducer.State;
type Action = suggestionsReducer.Action;
type Effect = suggestionsReducer.Effect;
type Exec = Parameters<EffectReducer<State, Action, Effect>>[2];

export const ALL_SOURCES_INCLUDED: suggestionsReducer.Included = {
  notes: true,
  script: true,
  animatic: true,
  beats: true,
};

export const createInitialSuggestionsState = (input: {
  videoId: string;
  included: suggestionsReducer.Included;
  notes: string;
  pickedFiles: string[];
}): State => ({
  videoId: input.videoId,
  open: false,
  included: input.included,
  script: null,
  notes: input.notes,
  repoFiles: [],
  pickedFiles: input.pickedFiles,
  contextModalOpen: false,
  notesPause: null,
  notesEditId: 0,
  context: {
    animatic: "",
    beats: "",
    clips: [],
    transcribedClipIds: [],
  },
  status: "idle",
  text: "",
  requestId: null,
  nextRequestId: 1,
  stream: null,
});

/** Each source's text for this Video; empty when the Video has none. */
export const getSourceTexts = (
  state: State
): Record<suggestionsReducer.Source, string> => ({
  notes: state.notes,
  script: state.script ?? "",
  animatic: state.context.animatic,
  beats: state.context.beats,
});

/** The picked repo files this Video still has, in path order. */
export const getPickedRepoFiles = (
  state: State
): suggestionsReducer.RepoFile[] => {
  const picked = new Set(state.pickedFiles);
  return state.repoFiles
    .filter((file) => picked.has(file.path))
    .sort((a, b) => a.path.localeCompare(b.path));
};

/** A file's rough token cost, from its size, as the Article Writer counts it. */
export const getRepoFilesTokens = (files: suggestionsReducer.RepoFile[]) =>
  files.reduce((sum, file) => sum + Math.ceil(file.size / 4), 0);

/**
 * What the request sends: the ticked sources this Video has, the picked repo
 * files it has, and the Clips.
 */
export const getSuggestionInput = (state: State): SuggestNextClipInput => {
  const texts = getSourceTexts(state);
  const input: SuggestNextClipInput = {
    clips: state.context.clips,
  };
  for (const source of suggestionsReducer.SOURCES) {
    if (state.included[source] && texts[source].trim().length > 0) {
      input[source] = texts[source];
    }
  }
  const files = getPickedRepoFiles(state).map((file) => file.path);
  if (files.length > 0) input.files = files;
  return input;
};

/**
 * The suggestion so far, as Markdown that is safe to render mid-stream: a
 * `**` whose closer has not arrived yet is closed, so it never shows as
 * literal asterisks.
 */
export const getSuggestionText = (state: State): string =>
  closeOpenBold(state.text);

export type TeleprompterSuggestion = {
  /** A new id is a new suggestion, which the glass centres. */
  id: number;
  text: string;
  /** The last few Clips before it, shown dimmed above it as context. */
  previousClips: string[];
};

/**
 * What the teleprompter shows instead of the Script: the suggestion while the
 * tab is open (empty while the first words are on their way), `null` when it
 * is closed. A failed suggestion hands the glass back to the Script too,
 * rather than leaving it waiting on words that are not coming.
 */
export const getTeleprompterSuggestion = (
  state: State
): TeleprompterSuggestion | null =>
  state.open && state.status !== "failed"
    ? {
        id: state.requestId ?? 0,
        text: getSuggestionText(state),
        previousClips: state.context.clips.slice(-MOST_RECENT_CLIP_COUNT),
      }
    : null;

const stopStream = (state: State, exec: Exec) => {
  if (state.stream) exec.stop(state.stream);
};

/** Ask for a fresh suggestion, superseding any in flight. */
const ask = (state: State, exec: Exec): State => {
  stopStream(state, exec);
  const requestId = state.nextRequestId;
  return {
    ...state,
    status: "waiting",
    text: "",
    requestId,
    nextRequestId: requestId + 1,
    stream: exec({
      type: "stream-suggestion",
      requestId,
      videoId: state.videoId,
      input: getSuggestionInput(state),
    }),
  };
};

/** Asking only makes sense with the tab open and the Script in hand. */
const canAsk = (state: State) => state.open && state.script !== null;

/**
 * Whether `next` can ask and would send something other than `prev` did: a
 * Clip added, deleted, moved or re-transcribed, the Insertion Point moved past
 * a Clip, a new Script, Animatic or Beats. A change to an unticked source
 * sends the same request, so it does not ask again.
 */
const asksDifferently = (prev: State, next: State) =>
  canAsk(next) &&
  (!canAsk(prev) ||
    JSON.stringify(getSuggestionInput(prev)) !==
      JSON.stringify(getSuggestionInput(next)));

export const suggestionsStateReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  switch (action.type) {
    case "suggestions-tab-opened": {
      if (state.open) return state;
      // Reload the Script in case it was edited while the tab was closed, but
      // ask now with the one in hand rather than wait for it.
      exec({ type: "load-script", videoId: state.videoId });
      const next = { ...state, open: true, status: "waiting" as const };
      return canAsk(next) ? ask(next, exec) : next;
    }

    case "suggestions-tab-closed":
      if (!state.open) return state;
      stopStream(state, exec);
      return {
        ...state,
        open: false,
        status: "idle",
        text: "",
        requestId: null,
        stream: null,
      };

    case "script-loaded": {
      if (action.videoId !== state.videoId) return state;
      if (action.script === state.script) return state;
      const next = { ...state, script: action.script };
      return asksDifferently(state, next) ? ask(next, exec) : next;
    }

    case "editor-context-changed": {
      const next = { ...state, context: action.context };
      // A new Clip whose transcript is empty changes no text, but it is still
      // a new Clip, so it asks too.
      const known = new Set(state.context.transcribedClipIds);
      const newTranscript = action.context.transcribedClipIds.some(
        (id) => !known.has(id)
      );
      return (newTranscript && canAsk(next)) || asksDifferently(state, next)
        ? ask(next, exec)
        : next;
    }

    case "source-toggled": {
      const included = {
        ...state.included,
        [action.source]: !state.included[action.source],
      };
      exec({ type: "store-included-sources", included });
      const next = { ...state, included };
      return canAsk(next) ? ask(next, exec) : next;
    }

    case "refresh-clicked":
      return canAsk(state) ? ask(state, exec) : state;

    case "notes-edited": {
      exec({
        type: "store-notes",
        videoId: state.videoId,
        notes: action.notes,
      });
      if (state.notesPause) exec.stop(state.notesPause);
      const editId = state.notesEditId + 1;
      return {
        ...state,
        notes: action.notes,
        notesEditId: editId,
        notesPause: exec({ type: "wait-for-notes-pause", editId }),
      };
    }

    case "notes-pause-elapsed": {
      if (action.editId !== state.notesEditId) return state;
      const next = { ...state, notesPause: null };
      return canAsk(next) ? ask(next, exec) : next;
    }

    case "repo-files-listed": {
      if (action.videoId !== state.videoId) return state;
      const next = { ...state, repoFiles: action.files };
      return asksDifferently(state, next) ? ask(next, exec) : next;
    }

    case "context-button-clicked":
      return { ...state, contextModalOpen: true };

    case "context-modal-dismissed":
      return { ...state, contextModalOpen: false };

    case "repo-files-picked": {
      const pickedFiles = [...new Set(action.paths)].sort();
      exec({
        type: "store-picked-files",
        videoId: state.videoId,
        paths: pickedFiles,
      });
      const next = { ...state, pickedFiles };
      return asksDifferently(state, next) ? ask(next, exec) : next;
    }

    case "suggestion-chunk-received":
      if (action.requestId !== state.requestId) return state;
      return { ...state, status: "streaming", text: action.text };

    case "suggestion-finished":
      if (action.requestId !== state.requestId) return state;
      // The text stream swallows a provider error and simply ends, so a
      // stream that ends with nothing said is a failure, not a suggestion.
      return {
        ...state,
        status: state.text.trim() === "" ? "failed" : "done",
        stream: null,
      };

    case "suggestion-failed":
      if (action.requestId !== state.requestId) return state;
      return { ...state, status: "failed", stream: null };
  }
};
