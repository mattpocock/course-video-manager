/**
 * Everything the teleprompter window knows, as one state machine.
 *
 * This window is driven entirely from outside itself — the editor's heartbeat,
 * the content poll, live script pushes, Stream Deck presses. Held as separate
 * `useState`s those arrive as a pile of effects that each set one field, and
 * the interesting behaviour (a poll landing after a live edit, a take ending
 * stopping the crawl, moving to a video that hasn't loaded yet) ends up spread
 * across their dependency arrays where it can't be seen or tested.
 *
 * So every input is an action and the transitions live here, pure. `at`
 * timestamps are passed in rather than read from the clock so the time-sensitive
 * rules are testable.
 *
 * The crawl is the one thing the editor doesn't drive: it rolls only when
 * someone presses play, and a take ending stops it.
 */
import type { CaptureStatus, EditorTab } from "@/lib/teleprompter-protocol";
import type { TeleprompterBeat } from "./beats-view";
import type { Source } from "./teleprompter-settings";

/** How long after a pong the editor is presumed still there. */
export const EDITOR_ALIVE_MS = 5000;
/**
 * How long a live script push outranks a poll result. A push carries text the
 * editor may not have finished saving, so a poll landing just after it is
 * *older* than what's already on the glass, however recently it was fetched.
 */
export const LIVE_SCRIPT_WINS_MS = 5000;

export namespace teleprompterSession {
  export interface Content {
    title: string;
    script: string;
    beats: TeleprompterBeat[];
  }

  export interface State {
    editorConnected: boolean;
    /** When the editor last said anything, for the liveness check. */
    lastPongAt: number;
    videoId: string | null;
    capture: CaptureStatus;
    content: Content;
    lastScriptPushAt: number;
    /** Whether the crawl is rolling. */
    playing: boolean;
    /**
     * What the editor's side panel is showing, mapped to a source. `null` until
     * the editor has said. The Reference tab has no counterpart on the glass, so
     * looking at a reference leaves this on whatever it was — the teleprompter
     * holds its ground rather than blanking.
     */
    editorSource: Source | null;
    /**
     * A tab chosen by hand on the glass, and the video it was chosen for.
     * Pinning is scoped to the video so moving to the next one lets the editor
     * decide again, and any change of the editor's own tab clears it — the
     * editor is the one driving, and a stale pin silently outranking it is
     * exactly the confusion this is meant to remove.
     */
    pinnedSource: { videoId: string | null; source: Source } | null;
  }

  export type Action =
    /** A pong, or the editor announcing itself on mount. */
    | {
        type: "editor-spoke";
        videoId: string | null;
        capture: CaptureStatus;
        tab: EditorTab;
        at: number;
      }
    | { type: "editor-disconnected" }
    /** The heartbeat timer, checking whether the editor has gone quiet. */
    | { type: "liveness-checked"; at: number }
    | { type: "content-fetched"; videoId: string; content: Content; at: number }
    | { type: "script-pushed"; videoId: string; script: string; at: number }
    | { type: "toggle-play" }
    | { type: "rewound" }
    | { type: "source-picked"; source: Source };

  export const EMPTY_CONTENT: Content = { title: "", script: "", beats: [] };

  export const initialState: State = {
    editorConnected: false,
    lastPongAt: 0,
    videoId: null,
    capture: "not-recording",
    content: EMPTY_CONTENT,
    lastScriptPushAt: 0,
    playing: false,
    editorSource: null,
    pinnedSource: null,
  };

  const isRecording = (capture: CaptureStatus): boolean =>
    capture !== "not-recording";

  /** The Reference tab has nothing to show on the glass — see `editorSource`. */
  const tabToSource = (tab: EditorTab): Source | null =>
    tab === "script" ? "script" : tab === "beats" ? "beats" : null;

  export const reducer = (state: State, action: Action): State => {
    switch (action.type) {
      case "editor-spoke": {
        const videoChanged = action.videoId !== state.videoId;
        const tabSource = tabToSource(action.tab);
        const editorSource = tabSource ?? state.editorSource;
        // Only a *change* of tab overrides a hand-picked source, so the pong
        // every two seconds doesn't keep undoing the choice.
        const tabChanged =
          tabSource !== null && tabSource !== state.editorSource;
        const takeEnded =
          isRecording(state.capture) && !isRecording(action.capture);
        return {
          ...state,
          editorConnected: true,
          lastPongAt: action.at,
          videoId: action.videoId,
          capture: action.capture,
          // Recording never starts the crawl: the first words of a take are
          // rarely the first words of the script, so rolling on record puts the
          // glass ahead of the delivery. Play is a deliberate press. The end of
          // a take does stop it, so the script can't run away between takes.
          playing: videoChanged || takeEnded ? false : state.playing,
          // A different video means the content on screen belongs to the last
          // one. Drop it rather than showing it under the new title.
          content: videoChanged ? EMPTY_CONTENT : state.content,
          lastScriptPushAt: videoChanged ? 0 : state.lastScriptPushAt,
          editorSource,
          pinnedSource: videoChanged || tabChanged ? null : state.pinnedSource,
        };
      }

      case "editor-disconnected":
        return {
          ...initialState,
          // Keep what's driving the glass: the editor reloading shouldn't flip
          // the document out from under you.
          editorSource: state.editorSource,
          pinnedSource: state.pinnedSource,
        };

      case "liveness-checked":
        if (
          !state.editorConnected ||
          action.at - state.lastPongAt <= EDITOR_ALIVE_MS
        ) {
          return state;
        }
        // Stop short of clearing the content: the editor window being closed or
        // reloaded shouldn't wipe the glass mid-take.
        return {
          ...state,
          editorConnected: false,
          capture: "not-recording",
          playing: false,
        };

      case "content-fetched": {
        if (action.videoId !== state.videoId) return state;
        const script =
          action.at - state.lastScriptPushAt < LIVE_SCRIPT_WINS_MS
            ? state.content.script
            : action.content.script;
        const next = { ...action.content, script };
        // Identity is preserved when nothing moved, so an unchanged poll can't
        // re-render the crawl and jog the reading position mid-take.
        return isSameContent(state.content, next)
          ? state
          : { ...state, content: next };
      }

      case "script-pushed":
        if (action.videoId !== state.videoId) return state;
        return {
          ...state,
          lastScriptPushAt: action.at,
          content:
            state.content.script === action.script
              ? state.content
              : { ...state.content, script: action.script },
        };

      case "toggle-play":
        return { ...state, playing: !state.playing };

      case "rewound":
        return { ...state, playing: false };

      case "source-picked":
        return {
          ...state,
          pinnedSource: { videoId: state.videoId, source: action.source },
        };
    }
  };

  const isSameContent = (a: Content, b: Content): boolean =>
    a.title === b.title &&
    a.script === b.script &&
    JSON.stringify(a.beats) === JSON.stringify(b.beats);

  /**
   * Which document is on the glass. Derived rather than stored, and driven by
   * the editor: you're looking at the Script tab, so the glass shows the script.
   * A tab picked by hand on the glass holds until the editor's own tab moves,
   * and until the editor has said anything the video's content decides.
   */
  export const resolveSource = (
    state: State,
    { hasScript, hasBeats }: { hasScript: boolean; hasBeats: boolean }
  ): Source => {
    if (state.pinnedSource && state.pinnedSource.videoId === state.videoId) {
      return state.pinnedSource.source;
    }
    if (state.editorSource) return state.editorSource;
    if (hasScript) return "script";
    if (hasBeats) return "beats";
    return "script";
  };
}
