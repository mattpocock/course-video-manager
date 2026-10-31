import type { ChatMessage } from "./broadcast-chat";
import { isLiveOn, type liveStreamReducer } from "./live-stream-reducer";

type State = liveStreamReducer.State;
type Effect = liveStreamReducer.Effect;

/**
 * THE CHAT HIGHLIGHT on the Live Stream surface (spec #2445, stories 69–71):
 * clicking a chat message shows it on the stream picture; clicking it again
 * hides it; clicking another replaces it. At most one shows. One click is out
 * at a time: a click while the last is unanswered does nothing. The recorder
 * stamps each edge and the app server stores it; this only says which
 * message shows.
 */
export type ChatHighlightState = {
  /** The message on the picture, and its Chat Highlight's id. */
  showing: { messageId: string; highlightId: string } | null;
  /** A show or hide is out: for this message. */
  pending: { messageId: string; press: "show" | "hide" } | null;
  /** Why the last click did nothing, until the next. */
  error: string | null;
};

export const NO_CHAT_HIGHLIGHT: ChatHighlightState = {
  showing: null,
  pending: null,
  error: null,
};

/** Why a click on a chat message shows nothing before Go Live. */
export const GO_LIVE_FIRST =
  "Go Live first: a Chat Highlight shows on the Live Stream picture.";

export type ChatHighlightAction =
  | { type: "chat-message-clicked"; videoId: string; messageId: string }
  | { type: "chat-highlight-shown"; messageId: string; highlightId: string }
  | { type: "chat-highlight-hidden"; highlightId: string }
  | { type: "chat-highlight-failed"; message: string };

export type ChatHighlightEffect =
  | { type: "show-highlight"; videoId: string; messageId: string }
  | { type: "hide-highlight"; videoId: string; highlightId: string };

const clicked = (
  state: State,
  { videoId, messageId }: { videoId: string; messageId: string },
  exec: (effect: Effect) => void
): State => {
  const h = state.highlight;
  if (h.pending) return state;
  if (!isLiveOn(state, videoId))
    return { ...state, highlight: { ...h, error: GO_LIVE_FIRST } };
  if (h.showing?.messageId === messageId) {
    exec({
      type: "hide-highlight",
      videoId,
      highlightId: h.showing.highlightId,
    });
    return {
      ...state,
      highlight: { ...h, pending: { messageId, press: "hide" }, error: null },
    };
  }
  exec({ type: "show-highlight", videoId, messageId });
  return {
    ...state,
    highlight: { ...h, pending: { messageId, press: "show" }, error: null },
  };
};

export const chatHighlightReducer = (
  state: State,
  action: ChatHighlightAction,
  exec: (effect: Effect) => void
): State => {
  const h = state.highlight;
  switch (action.type) {
    case "chat-message-clicked":
      return clicked(state, action, exec);
    case "chat-highlight-shown":
      return {
        ...state,
        highlight: {
          showing: {
            messageId: action.messageId,
            highlightId: action.highlightId,
          },
          pending: null,
          error: null,
        },
      };
    case "chat-highlight-hidden":
      return {
        ...state,
        highlight: {
          showing:
            h.showing?.highlightId === action.highlightId ? null : h.showing,
          pending: null,
          error: null,
        },
      };
    case "chat-highlight-failed":
      return {
        ...state,
        highlight: { ...h, pending: null, error: action.message },
      };
  }
};

/** A chat row: the message, and whether it is (or is about to be) on the picture. */
export type ChatRow = ChatMessage & {
  highlighted: boolean;
  /** A click on it is out. */
  pending: boolean;
};

export const chatRows = (state: State): ChatRow[] =>
  state.chat.messages.map((message) => ({
    ...message,
    highlighted: state.highlight.showing?.messageId === message.id,
    pending: state.highlight.pending?.messageId === message.id,
  }));
