import type { EffectReducer } from "use-effect-reducer";

/**
 * The writer's Writer Chats for one field of a Video: loaded from the Video
 * when the writer opens, the open mode's shown, and each settled turn saved
 * back. A failed load or save is shown, never dropped. The messages
 * themselves live in the AI SDK's `useChat`; this reducer decides what it
 * shows and what is saved. See docs/FRONTEND_STATE.md.
 */
export namespace writerChatReducer {
  /** A field's Writer Chats, by mode. */
  export type Chats = Record<string, unknown[]>;

  export interface State {
    videoId: string;
    fieldId: string;
    mode: string;
    /** As last loaded or saved; null until the load answers. */
    chats: Chats | null;
    loadError: string | null;
    /** The save that failed, so Retry can send it again. */
    failedSave: { mode: string; messages: unknown[]; message: string } | null;
  }

  export type Action =
    | { type: "writer-chats-loaded"; chats: Chats }
    | { type: "writer-chats-load-failed"; message: string }
    | { type: "load-retry-clicked" }
    /** A turn ended, a message was edited, or the chat was cleared. */
    | { type: "turn-settled"; mode: string; messages: unknown[] }
    /** `messages`: the mode being left's, as shown when the pick was made. */
    | { type: "mode-picked"; mode: string; messages: unknown[] }
    | { type: "writer-chat-saved" }
    /** `mode` and `messages`: what the failed save sent. */
    | {
        type: "writer-chat-save-failed";
        mode: string;
        messages: unknown[];
        message: string;
      }
    | { type: "save-retry-clicked" };

  export type Effect =
    | { type: "load-writer-chats"; videoId: string; fieldId: string }
    /** Put these messages in the chat. */
    | { type: "show-messages"; messages: unknown[] }
    | {
        type: "save-writer-chat";
        videoId: string;
        fieldId: string;
        mode: string;
        messages: unknown[];
      };
}

type State = writerChatReducer.State;
type Exec = (effect: writerChatReducer.Effect) => void;

export const createInitialWriterChatState = (opts: {
  videoId: string;
  fieldId: string;
  mode: string;
}): State => ({ ...opts, chats: null, loadError: null, failedSave: null });

export const loadEffect = (state: State): writerChatReducer.Effect => ({
  type: "load-writer-chats",
  videoId: state.videoId,
  fieldId: state.fieldId,
});

/** What the writer says about its chat: loading, or a load or save that failed. */
export const selectWriterChatNotice = (
  state: State
):
  | { kind: "loading" }
  | { kind: "load-failed" | "save-failed"; message: string }
  | null => {
  if (state.loadError !== null) {
    return { kind: "load-failed", message: state.loadError };
  }
  if (state.chats === null) return { kind: "loading" };
  if (state.failedSave) {
    return { kind: "save-failed", message: state.failedSave.message };
  }
  return null;
};

/** Hold sends until the chat is loaded, so a load never replaces a new turn. */
export const selectWriterChatLoading = (state: State) => state.chats === null;

const saveChat = (
  state: State,
  mode: string,
  messages: unknown[],
  exec: Exec
): State => {
  exec({
    type: "save-writer-chat",
    videoId: state.videoId,
    fieldId: state.fieldId,
    mode,
    messages,
  });
  return { ...state, chats: { ...state.chats, [mode]: messages } };
};

const modePicked = (
  state: State,
  action: Extract<writerChatReducer.Action, { type: "mode-picked" }>,
  exec: Exec
): State => {
  if (state.chats === null) return { ...state, mode: action.mode };
  const left = state.chats[state.mode];
  const saved =
    action.messages.length > 0 && action.messages !== left
      ? saveChat(state, state.mode, action.messages, exec)
      : state;
  exec({ type: "show-messages", messages: saved.chats?.[action.mode] ?? [] });
  return { ...saved, mode: action.mode };
};

export const writerChatReducer: EffectReducer<
  writerChatReducer.State,
  writerChatReducer.Action,
  writerChatReducer.Effect
> = (state, action, exec) => {
  switch (action.type) {
    case "writer-chats-loaded":
      exec({ type: "show-messages", messages: action.chats[state.mode] ?? [] });
      return { ...state, chats: action.chats, loadError: null };
    case "writer-chats-load-failed":
      return { ...state, loadError: action.message };
    case "load-retry-clicked":
      if (state.loadError === null) return state;
      exec(loadEffect(state));
      return { ...state, loadError: null };
    case "turn-settled":
      // Before the load answers, nothing is saved over what it will show.
      if (state.chats === null) return state;
      if (state.chats[action.mode] === action.messages) return state;
      return saveChat(state, action.mode, action.messages, exec);
    case "mode-picked":
      return modePicked(state, action, exec);
    case "writer-chat-saved":
      return state.failedSave ? { ...state, failedSave: null } : state;
    case "writer-chat-save-failed":
      return {
        ...state,
        failedSave: {
          mode: action.mode,
          messages: action.messages,
          message: action.message,
        },
      };
    case "save-retry-clicked": {
      const failed = state.failedSave;
      if (!failed) return state;
      return saveChat(state, failed.mode, failed.messages, exec);
    }
  }
};
