/**
 * The Video Editor's **Suggestions** tab: what to say in the next Clip,
 * streamed from the model and mirrored onto the teleprompter.
 *
 * The rules, all decided here:
 *
 *   - Nothing runs unless the tab is open. Opening it loads the Script (the
 *     editor's loader leaves the Script text out) and then asks.
 *   - A new Clip's transcript, a ticked or unticked source, or Refresh asks
 *     again. So do the author's Notes, once typing pauses for a second. A newer request stops the one in flight: only the newest
 *     suggestion ever shows.
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
 */
import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import type { SuggestNextClipInput } from "@/prompts/generate-suggest-next-clip";

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
    /** Transcripts of the most recent Clips, oldest first. */
    recentClips: string[];
    /** Every Clip whose transcript has arrived, so a new one is noticed. */
    transcribedClipIds: string[];
  };

  export type Status = "idle" | "waiting" | "streaming" | "done" | "failed";

  export interface State {
    videoId: string;
    open: boolean;
    included: Included;
    /** `null` until loaded for this opening of the tab. */
    script: string | null;
    /** This Video's Notes, as typed. */
    notes: string;
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
}): State => ({
  videoId: input.videoId,
  open: false,
  included: input.included,
  script: null,
  notes: input.notes,
  notesPause: null,
  notesEditId: 0,
  context: {
    animatic: "",
    beats: "",
    recentClips: [],
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

/** What the request sends: the ticked sources this Video has, and the Clips. */
export const getSuggestionInput = (state: State): SuggestNextClipInput => {
  const texts = getSourceTexts(state);
  const input: SuggestNextClipInput = {
    recentClips: state.context.recentClips,
  };
  for (const source of suggestionsReducer.SOURCES) {
    if (state.included[source] && texts[source].trim().length > 0) {
      input[source] = texts[source];
    }
  }
  return input;
};

/**
 * What the teleprompter shows instead of the Script: the suggestion while the
 * tab is open (empty while the first words are on their way), `null` when it
 * is closed. A failed suggestion hands the glass back to the Script too,
 * rather than leaving it waiting on words that are not coming.
 */
export const getTeleprompterSuggestion = (state: State): string | null =>
  state.open && state.status !== "failed" ? state.text : null;

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

export const suggestionsStateReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  switch (action.type) {
    case "suggestions-tab-opened":
      if (state.open) return state;
      exec({ type: "load-script", videoId: state.videoId });
      return { ...state, open: true, script: null, status: "waiting" };

    case "suggestions-tab-closed":
      if (!state.open) return state;
      stopStream(state, exec);
      return {
        ...state,
        open: false,
        script: null,
        status: "idle",
        text: "",
        requestId: null,
        stream: null,
      };

    case "script-loaded":
      // Late: the tab closed, or the Script already came in.
      if (!state.open || state.script !== null) return state;
      if (action.videoId !== state.videoId) return state;
      return ask({ ...state, script: action.script }, exec);

    case "editor-context-changed": {
      const next = { ...state, context: action.context };
      const known = new Set(state.context.transcribedClipIds);
      const newTranscript = action.context.transcribedClipIds.some(
        (id) => !known.has(id)
      );
      return newTranscript && canAsk(next) ? ask(next, exec) : next;
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
