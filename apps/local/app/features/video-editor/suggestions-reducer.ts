/**
 * The Video Editor's **Suggestions** tab: what to say in the next Clip,
 * streamed from the model and mirrored onto the teleprompter.
 *
 * The rules, all decided here:
 *
 *   - Every request brings one Suggestion, which the teleprompter shows
 *     alone. The author guides it with a Steer rather than by picking among
 *     alternatives (#2708).
 *   - Nothing runs unless the tab is open. The Script is loaded when the
 *     editor opens (the editor's loader leaves the Script text out), so
 *     opening the tab asks at once. It reloads the Script too, in case it was
 *     edited in the Script tab, and asks again if it changed.
 *   - Any change to what a suggestion is made from asks again AT ONCE, with
 *     no wait: a new Clip's transcript, a Clip deleted, moved or re-transcribed,
 *     the Insertion Point moved, the Animatic or Beats changed, a source
 *     ticked or unticked, a Steer given, edited or cleared, or Refresh. The
 *     exception is the on-screen Diagram's text, which asks once editing
 *     pauses for a second.
 *   - A newer request stops the one in flight: only the newest Suggestions
 *     ever show.
 *   - Closing the tab stops the stream and forgets the suggestion, so the
 *     teleprompter goes back to the Script.
 *   - A Video that OPENS on the tab (the tab is remembered across Videos)
 *     asks nothing and leaves the teleprompter on the Script until Refresh
 *     (#2415), so moving to the next Video never starts a model call by
 *     itself. Clicking the tab open still asks at once.
 *
 * Which sources are ticked is one global choice, not one per Video. A ticked
 * source this Video doesn't have is simply not sent; the tick is kept.
 *
 * The **Steer** in effect at the Insertion Point goes with the request; the
 * rules for which one that is live in `steers.ts`.
 *
 * The **repo files** are picked one by one in the Context modal, from the
 * Video's own files (the Article Writer's `FileTree`). The pick is kept per
 * Video in localStorage. The
 * request names the picked paths; the route reads them. Changing the pick
 * asks again at once. A picked file the Video no longer has is not sent, but
 * stays picked.
 *
 * The **Diagram** source is the Diagram Text of the Active Diagram, the one
 * on screen in the Diagram Playground, reported live by the playground. No
 * Active Diagram (the playground closed, or on Playground Home) sends none.
 * It comes one line per shape. When it is sent and the Clip just before the
 * Insertion Point has a DiagramSnapshot pinned, that snapshot is named too,
 * so the prompt can show the Diagram as a diff against it; a new pin asks
 * again at once, like any other change to the Clips.
 * A change to it while unticked is kept but does not ask.
 *
 * The **Previous video** source is the transcripts of the previous Video's
 * Clips (the one before this in course order), loaded with the editor and
 * capped, keeping the end. It is for the start of a Video only: once
 * `PREVIOUS_VIDEO_CLIP_LIMIT` Clips are before the Insertion Point it is not
 * sent, whatever the tick says, and below that the tick decides again. That
 * is derived from the Clips, never stored.
 */
import type { EffectEntity, EffectReducer } from "use-effect-reducer";
import {
  MOST_RECENT_CLIP_COUNT,
  capPreviousVideoText,
  type SuggestNextClipInput,
} from "@/prompts/generate-suggest-next-clip";
import { closeOpenBold } from "@/lib/close-open-bold";
import {
  clearSteer as clearSteerAt,
  findSteerInEffect,
  giveSteer,
  markSteersUsedUp,
  type Steer as SteerEntry,
} from "./steers";

export namespace suggestionsReducer {
  export type Source =
    "script" | "animatic" | "beats" | "diagram" | "previousVideo";
  export const SOURCES: readonly Source[] = [
    "script",
    "animatic",
    "beats",
    "diagram",
    "previousVideo",
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
    /**
     * The DiagramSnapshot pinned to the Clip just before the Insertion Point;
     * `null` when it has none, or there is no Clip before it.
     */
    diagramSnapshotId: string | null;
    /**
     * The item (Clip or Chapter) just before the Insertion Point; `null` at the
     * start of the Video. A Steer belongs to it.
     */
    insertionAnchor: string | null;
    /**
     * Every Clip on the timeline, archived ones left out, with the item just
     * before it; `null` for the first.
     */
    previousItems: Record<string, string | null>;
  };

  export type Steer = SteerEntry;

  export type Status = "idle" | "waiting" | "streaming" | "done" | "failed";

  /** One of the Video's files the Context modal offers. */
  export type RepoFile = { path: string; size: number };

  export interface State {
    videoId: string;
    open: boolean;
    /**
     * The editor opened on this tab: nothing asks, and the teleprompter keeps
     * the Script, until Refresh.
     */
    awaitingRefresh: boolean;
    included: Included;
    /** `null` until the first load comes back. */
    script: string | null;
    /** The Active Diagram's Diagram Text; empty when there is none. */
    diagramText: string;
    /** Transcripts of the previous Video's Clips, oldest first; `[]` for none. */
    previousVideoClips: string[];
    /** The Video's files the Context modal offers; images are left out. */
    repoFiles: RepoFile[];
    /** The repo file paths the author picked for this Video. */
    pickedFiles: string[];
    /** Whether the Context modal is showing. */
    contextModalOpen: boolean;
    /** The pause after the last Diagram edit, before asking again. */
    editPause: EffectEntity<State, Action> | null;
    /** Which edit the running pause is for; an older one is late. */
    editId: number;
    context: EditorContext;
    status: Status;
    /** Every Steer given in this editor, oldest first. */
    steers: Steer[];
    nextSteerId: number;
    /** The Steer being typed; `null` when its box is closed. */
    steerDraft: string | null;
    /** The Suggestion's text so far; empty before it arrives. */
    suggestion: string;
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
    | { type: "diagram-text-changed"; text: string }
    | { type: "edit-pause-elapsed"; editId: number }
    | { type: "repo-files-listed"; videoId: string; files: RepoFile[] }
    | { type: "context-button-clicked" }
    | { type: "context-modal-dismissed" }
    | { type: "repo-files-picked"; paths: string[] }
    | { type: "steer-button-clicked" }
    | { type: "steer-draft-edited"; text: string }
    | { type: "steer-submitted" }
    | { type: "steer-draft-dismissed" }
    | { type: "steer-cleared" }
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
    | { type: "store-picked-files"; videoId: string; paths: string[] }
    | { type: "wait-for-edit-pause"; editId: number };
}

type State = suggestionsReducer.State;
type Action = suggestionsReducer.Action;
type Effect = suggestionsReducer.Effect;
type Exec = Parameters<EffectReducer<State, Action, Effect>>[2];

export const ALL_SOURCES_INCLUDED: suggestionsReducer.Included = {
  script: true,
  animatic: true,
  beats: true,
  diagram: true,
  previousVideo: true,
};

/**
 * How many Clips before the Insertion Point put the previous Video out of
 * reach: past the start of this one, it no longer helps.
 */
export const PREVIOUS_VIDEO_CLIP_LIMIT = 5;

export const createInitialSuggestionsState = (input: {
  videoId: string;
  included: suggestionsReducer.Included;
  pickedFiles: string[];
  previousVideoClips?: string[];
  /** The editor opened on the Suggestions tab, remembered from another Video. */
  openedOnTab?: boolean;
}): State => ({
  videoId: input.videoId,
  open: input.openedOnTab ?? false,
  awaitingRefresh: input.openedOnTab ?? false,
  included: input.included,
  script: null,
  diagramText: "",
  previousVideoClips: input.previousVideoClips ?? [],
  repoFiles: [],
  pickedFiles: input.pickedFiles,
  contextModalOpen: false,
  editPause: null,
  editId: 0,
  context: {
    animatic: "",
    beats: "",
    clips: [],
    transcribedClipIds: [],
    diagramSnapshotId: null,
    insertionAnchor: null,
    previousItems: {},
  },
  steers: [],
  nextSteerId: 1,
  steerDraft: null,
  status: "idle",
  suggestion: "",
  requestId: null,
  nextRequestId: 1,
  stream: null,
});

/** Each source's text for this Video; empty when the Video has none. */
export const getSourceTexts = (
  state: State
): Record<suggestionsReducer.Source, string> => ({
  script: state.script ?? "",
  animatic: state.context.animatic,
  beats: state.context.beats,
  diagram: state.diagramText,
  previousVideo: capPreviousVideoText(state.previousVideoClips.join("\n")),
});

/**
 * Whether the previous Video can be sent at all: only while fewer than
 * `PREVIOUS_VIDEO_CLIP_LIMIT` Clips are before the Insertion Point.
 */
export const isPreviousVideoInReach = (state: State): boolean =>
  state.context.clips.length < PREVIOUS_VIDEO_CLIP_LIMIT;

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
 * The Steer guiding the next Suggestion: the newest one at the Insertion
 * Point's anchor that is not used up.
 */
export const getSteerInEffect = (
  state: State
): suggestionsReducer.Steer | undefined =>
  findSteerInEffect(
    state.steers,
    state.context.insertionAnchor,
    state.context.previousItems
  );

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
    if (source === "previousVideo" && !isPreviousVideoInReach(state)) continue;
    if (state.included[source] && texts[source].trim().length > 0) {
      input[source] = texts[source];
    }
  }
  if (input.diagram !== undefined && state.context.diagramSnapshotId) {
    input.diagramSnapshotId = state.context.diagramSnapshotId;
  }
  const files = getPickedRepoFiles(state).map((file) => file.path);
  if (files.length > 0) input.files = files;
  const steer = getSteerInEffect(state);
  if (steer) input.steer = steer.text;
  return input;
};

/**
 * The Suggestion's text so far, as Markdown that is safe to render mid-stream:
 * a `**` whose closer has not arrived yet is closed, so it never shows as
 * literal asterisks.
 */
export const getSuggestionText = (state: State): string =>
  closeOpenBold(state.suggestion);

export type TeleprompterSuggestion = {
  /** A new id is a new suggestion, which the glass centres. */
  id: number;
  text: string;
  /** The last few Clips before it, shown dimmed above it as context. */
  previousClips: string[];
};

/**
 * What the teleprompter shows instead of the Script: the Suggestion's text
 * alone while the tab is open (empty while its first words are on their way),
 * `null` when it is closed. A failed suggestion hands the glass back to the Script too,
 * rather than leaving it waiting on words that are not coming.
 */
export const getTeleprompterSuggestion = (
  state: State
): TeleprompterSuggestion | null =>
  state.open && !state.awaitingRefresh && state.status !== "failed"
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
    suggestion: "",
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
const canAsk = (state: State) =>
  state.open && !state.awaitingRefresh && state.script !== null;

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

/** Wait for editing to pause again, dropping any pause already running. */
const restartEditPause = (state: State, exec: Exec): State => {
  if (state.editPause) exec.stop(state.editPause);
  const editId = state.editId + 1;
  return {
    ...state,
    editId,
    editPause: exec({ type: "wait-for-edit-pause", editId }),
  };
};

/** Remove the Steer in effect, asking again if that changes the request. */
const clearSteer = (state: State, exec: Exec): State => {
  const steers = clearSteerAt(
    state.steers,
    state.context.insertionAnchor,
    state.context.previousItems
  );
  if (steers === state.steers) return state;
  const next = { ...state, steers };
  return asksDifferently(state, next) ? ask(next, exec) : next;
};

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
        awaitingRefresh: false,
        status: "idle",
        suggestion: "",
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
      // A new Clip whose transcript is empty changes no text, but it is still
      // a new Clip, so it asks too.
      const known = new Set(state.context.transcribedClipIds);
      const accepted = action.context.transcribedClipIds.filter(
        (id) => !known.has(id)
      );
      const newTranscript = accepted.length > 0;
      const next = {
        ...state,
        context: action.context,
        steers: markSteersUsedUp(
          state.steers,
          accepted,
          action.context.previousItems
        ),
      };
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

    case "refresh-clicked": {
      const next = { ...state, awaitingRefresh: false };
      return canAsk(next) ? ask(next, exec) : next;
    }

    case "diagram-text-changed": {
      // The playground repeats the text with every heartbeat.
      if (action.text === state.diagramText) return state;
      const next = { ...state, diagramText: action.text };
      return next.included.diagram ? restartEditPause(next, exec) : next;
    }

    case "edit-pause-elapsed": {
      if (action.editId !== state.editId) return state;
      const next = { ...state, editPause: null };
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

    case "steer-button-clicked":
      return { ...state, steerDraft: getSteerInEffect(state)?.text ?? "" };

    case "steer-draft-edited":
      if (state.steerDraft === null) return state;
      return { ...state, steerDraft: action.text };

    case "steer-draft-dismissed":
      return { ...state, steerDraft: null };

    case "steer-submitted": {
      if (state.steerDraft === null) return state;
      const text = state.steerDraft.trim();
      const closed = { ...state, steerDraft: null };
      if (text === "") return clearSteer(closed, exec);
      const next: State = {
        ...closed,
        nextSteerId: state.nextSteerId + 1,
        steers: giveSteer(state.steers, {
          id: state.nextSteerId,
          anchor: state.context.insertionAnchor,
          text,
          previousItems: state.context.previousItems,
        }),
      };
      return asksDifferently(state, next) ? ask(next, exec) : next;
    }

    case "steer-cleared":
      return clearSteer(state, exec);

    case "suggestion-chunk-received":
      if (action.requestId !== state.requestId) return state;
      return { ...state, status: "streaming", suggestion: action.text };

    case "suggestion-finished":
      if (action.requestId !== state.requestId) return state;
      // The text stream swallows a provider error and simply ends, so a
      // stream that ends with nothing said is a failure, not a suggestion.
      return {
        ...state,
        status: state.suggestion.trim() !== "" ? "done" : "failed",
        stream: null,
      };

    case "suggestion-failed":
      if (action.requestId !== state.requestId) return state;
      return { ...state, status: "failed", stream: null };
  }
};
