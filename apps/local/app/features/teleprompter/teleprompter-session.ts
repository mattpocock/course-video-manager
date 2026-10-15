/**
 * Everything the teleprompter window knows, as one state machine.
 *
 * This window is driven entirely from outside itself — the editor's heartbeat,
 * the content poll, live script pushes, Stream Deck presses. Held as separate
 * `useState`s those arrive as a pile of effects that each set one field, and
 * the interesting behaviour (a poll landing after a live edit, moving to a
 * video that hasn't loaded yet) ends up spread across their dependency arrays
 * where it can't be seen or tested.
 *
 * So every input is an action and the transitions live here, pure. `at`
 * timestamps are passed in rather than read from the clock so the time-sensitive
 * rules are testable.
 */
import type {
  CaptureStatus,
  ClipMarks,
  ClipMarkIds,
} from "@/lib/teleprompter-protocol";

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
  }

  export interface State {
    editorConnected: boolean;
    /** When the editor last said anything, for the liveness check. */
    lastPongAt: number;
    videoId: string | null;
    capture: CaptureStatus;
    /**
     * This recording session's clips and what state each is in, as last pushed
     * by the editor. Held rather than derived: the glass has no access to the
     * clip reducer.
     */
    marks: ClipMarks;
    /**
     * The Clip each mark stands for, same order as `marks`, so a clicked dot
     * can name its Clip. Empty from an editor too old to send them.
     */
    markClipIds: ClipMarkIds;
    /**
     * The Clip the editor's player is playing, as last pushed. `null` when it
     * is paused, or there is nobody to ask. Its dot is drawn light blue.
     */
    playingClipId: string | null;
    /**
     * The newest transcribed clip in this recording session, as last pushed by
     * the editor. `null` when there is none, or nobody to ask.
     */
    latestTranscript: string | null;
    /**
     * How long the Video runs so far, in seconds, as last pushed by the
     * editor. `null` when there is nobody to ask.
     */
    videoLengthSeconds: number | null;
    /**
     * The editor's Suggestions tab's line, as last pushed, shown in place of
     * the Script. `null` when that tab is closed, or there is nobody to ask.
     */
    suggestion: string | null;
    content: Content;
    lastScriptPushAt: number;
  }

  export type Action =
    /**
     * The editor pushed what it has open, because something about it changed
     * (or because we just said hello). Never arrives on a timer.
     */
    | {
        type: "editor-state";
        videoId: string | null;
        capture: CaptureStatus;
        /** Absent from an editor running older code; treated as no session. */
        marks?: ClipMarks;
        /** Absent from an editor running older code; treated as none. */
        markClipIds?: ClipMarkIds;
        /** Absent from an editor running older code; treated as paused. */
        playingClipId?: string | null;
        /** Absent from an editor running older code; treated as none. */
        latestTranscript?: string | null;
        /** Absent from an editor running older code; treated as unknown. */
        videoLengthSeconds?: number | null;
        /** Absent from an editor running older code; treated as none. */
        suggestion?: string | null;
        at: number;
      }
    /** A bare pong: the editor is still there, and nothing has changed. */
    | { type: "editor-alive"; at: number }
    | { type: "editor-disconnected" }
    /** The heartbeat timer, checking whether the editor has gone quiet. */
    | { type: "liveness-checked"; at: number }
    | { type: "content-fetched"; videoId: string; content: Content; at: number }
    | { type: "script-pushed"; videoId: string; script: string; at: number };

  export const EMPTY_CONTENT: Content = {
    title: "",
    script: "",
  };

  /** No session under way, or nobody to ask. */
  export const NO_MARKS: ClipMarks = [];

  export const initialState: State = {
    editorConnected: false,
    lastPongAt: 0,
    videoId: null,
    capture: "not-recording",
    marks: NO_MARKS,
    markClipIds: [],
    playingClipId: null,
    latestTranscript: null,
    videoLengthSeconds: null,
    suggestion: null,
    content: EMPTY_CONTENT,
    lastScriptPushAt: 0,
  };

  export const reducer = (state: State, action: Action): State => {
    switch (action.type) {
      case "editor-alive":
        return state.editorConnected && state.lastPongAt === action.at
          ? state
          : { ...state, editorConnected: true, lastPongAt: action.at };

      case "editor-state": {
        const videoChanged = action.videoId !== state.videoId;
        return {
          ...state,
          editorConnected: true,
          lastPongAt: action.at,
          videoId: action.videoId,
          capture: action.capture,
          // A different video's leftovers aren't this video's problem.
          marks: videoChanged ? NO_MARKS : (action.marks ?? NO_MARKS),
          markClipIds: videoChanged ? [] : (action.markClipIds ?? []),
          playingClipId: action.playingClipId ?? null,
          latestTranscript: videoChanged
            ? null
            : (action.latestTranscript ?? null),
          // Unlike the session's leftovers, the length always describes the
          // video it arrived with, so a new video's first push is believed.
          videoLengthSeconds: action.videoLengthSeconds ?? null,
          suggestion: videoChanged ? null : (action.suggestion ?? null),
          // A different video means the content on screen belongs to the last
          // one. Drop it rather than showing it under the new title.
          content: videoChanged ? EMPTY_CONTENT : state.content,
          lastScriptPushAt: videoChanged ? 0 : state.lastScriptPushAt,
        };
      }

      case "editor-disconnected":
        return initialState;

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
          // Marks we can no longer refresh are worse than no marks: a frozen
          // row of dots reads as a live claim about clips nobody is reporting
          // on any more.
          marks: NO_MARKS,
          markClipIds: [],
          playingClipId: null,
          latestTranscript: null,
          videoLengthSeconds: null,
          // A suggestion nobody can withdraw would hide the Script for good.
          suggestion: null,
        };

      case "content-fetched": {
        if (action.videoId !== state.videoId) return state;
        const script =
          action.at - state.lastScriptPushAt < LIVE_SCRIPT_WINS_MS
            ? state.content.script
            : action.content.script;
        const next = { ...action.content, script };
        // Identity is preserved when nothing moved, so an unchanged poll can't
        // re-render the script and jog the reading position mid-take.
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
    }
  };

  /**
   * What goes on the glass: the Suggestions tab's line while it is open,
   * otherwise the Script.
   */
  export const glassScript = (state: State): string =>
    state.suggestion ?? state.content.script;

  const isSameContent = (a: Content, b: Content): boolean =>
    a.title === b.title && a.script === b.script;
}
