import type { EffectReducer } from "use-effect-reducer";

/**
 * Keeps a Monaco markdown editor and its host's `value` prop in step without
 * losing keystrokes. See docs/FRONTEND_STATE.md.
 *
 * The host round-trips each edit (a save, a fetcher's optimistic value) and
 * hands it back down as `value`, a few keystrokes late when the user types
 * fast. Writing that late value into the editor would wipe the keystrokes
 * typed since. So a `value` the editor itself emitted, and has since moved
 * past, is an echo and is ignored; any other `value` that differs from the
 * editor's text came from outside (the writer's Apply, a revalidation) and
 * replaces it.
 */
export namespace markdownEditorSyncReducer {
  export interface State {
    /**
     * Texts the editor has emitted that the host has not yet handed back, in
     * order. Cleared whenever `value` matches the editor's text.
     */
    pendingEchoes: string[];
  }

  export type Action =
    /** The user edited the text; `value` is the editor's full text. */
    | { type: "editor-content-changed"; value: string }
    /** The host passed a new `value`; `modelValue` is the editor's text now. */
    | { type: "value-prop-received"; value: string; modelValue: string };

  export type Effect = { type: "replace-text"; text: string };
}

/**
 * A host that never hands `value` back (no `onChange` round-trip) would grow
 * the echo list forever; the lag window is only ever a few keystrokes.
 */
const MAX_PENDING_ECHOES = 200;

export const createInitialMarkdownEditorSyncState =
  (): markdownEditorSyncReducer.State => ({ pendingEchoes: [] });

export const markdownEditorSyncReducer: EffectReducer<
  markdownEditorSyncReducer.State,
  markdownEditorSyncReducer.Action,
  markdownEditorSyncReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "editor-content-changed":
      return {
        pendingEchoes: [...state.pendingEchoes, action.value].slice(
          -MAX_PENDING_ECHOES
        ),
      };
    case "value-prop-received": {
      if (action.value === action.modelValue) return { pendingEchoes: [] };
      const echoIndex = state.pendingEchoes.indexOf(action.value);
      if (echoIndex !== -1) {
        return { pendingEchoes: state.pendingEchoes.slice(echoIndex + 1) };
      }
      exec({ type: "replace-text", text: action.value });
      return { pendingEchoes: [] };
    }
  }
};
