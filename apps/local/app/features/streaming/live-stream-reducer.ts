import type { EffectReducer } from "use-effect-reducer";
import {
  broadcastRefusal,
  type Broadcast,
  type BroadcastListAnswer,
  type ReconnectReason,
} from "./broadcast";
import type {
  BroadcastChatEvent,
  BroadcastPick,
  ChatSnapshot,
} from "./broadcast-chat";

/**
 * The app-wide Live Stream surface, mounted at the app root like the Upload
 * Manager's Jobs, so what it holds survives leaving the Streaming tab. It
 * holds the Broadcast picker, the picked **Broadcast** and its chat buffer;
 * later tickets add the Live Stream's status and health and the current Chat
 * Highlight (spec #2445). The app server reads the chat (`services/
 * broadcast-chat.ts`); this buffer is what the Streaming tab has heard of it.
 */
export namespace liveStreamReducer {
  export type BroadcastList =
    /** Not listed yet in this tab. */
    | { status: "unlisted" }
    | { status: "listed"; broadcasts: Broadcast[] }
    | { status: "needs-reconnect"; reason: ReconnectReason }
    | { status: "failed"; message: string };

  export type State = {
    broadcastList: BroadcastList;
    /** A listing is out. */
    listing: boolean;
    pickedBroadcast: Broadcast | null;
    /** The chat buffer: the picked Broadcast's chat, as the app server relays it. */
    chat: ChatSnapshot;
  };

  export type Action =
    /** The Streaming tab drew the Broadcast picker. */
    | { type: "broadcast-picker-shown" }
    | { type: "refresh-broadcasts-clicked" }
    | { type: "broadcasts-answered"; answer: BroadcastListAnswer }
    | { type: "broadcast-listing-failed"; message: string }
    | { type: "broadcast-clicked"; broadcastId: string }
    /** Heard from the app server's chat (`GET /api/streaming/chat/events`). */
    | BroadcastChatEvent;

  export type Effect =
    | { type: "list-broadcasts" }
    /** The app server reads this Broadcast's chat from now on. */
    | { type: "pick-broadcast"; pick: BroadcastPick };
}

type State = liveStreamReducer.State;
type Action = liveStreamReducer.Action;
type Effect = liveStreamReducer.Effect;

export const createInitialLiveStreamState = (): State => ({
  broadcastList: { status: "unlisted" },
  listing: false,
  pickedBroadcast: null,
  chat: { broadcastId: null, connection: { state: "idle" }, messages: [] },
});

/** As many chat messages as the app server keeps (`broadcast-chat-live.server.ts`). */
const MAX_CHAT_MESSAGES = 500;

type Exec = (effect: Effect) => void;

/** A listed Broadcast by id, or `null`. */
const listedBroadcast = (state: State, id: string): Broadcast | null =>
  state.broadcastList.status === "listed"
    ? (state.broadcastList.broadcasts.find((b) => b.id === id) ?? null)
    : null;

const broadcastsAnswered = (
  state: State,
  answer: BroadcastListAnswer
): State => {
  if (answer.status === "needs-reconnect") {
    return {
      ...state,
      listing: false,
      broadcastList: { status: "needs-reconnect", reason: answer.reason },
    };
  }
  // The picked Broadcast follows YouTube's latest word on it; once it is no
  // longer upcoming or active it can't be streamed to. After a reload, it is
  // the one whose chat the app server kept.
  const pickedId = state.pickedBroadcast?.id ?? state.chat.broadcastId;
  return {
    ...state,
    listing: false,
    broadcastList: { status: "listed", broadcasts: answer.broadcasts },
    pickedBroadcast:
      pickedId === null
        ? null
        : (answer.broadcasts.find((b) => b.id === pickedId) ?? null),
  };
};

/** Picking a Broadcast hands its chat to the app server, unless it has it. */
const broadcastClicked = (
  state: State,
  broadcastId: string,
  exec: Exec
): State => {
  const broadcast = listedBroadcast(state, broadcastId);
  if (!broadcast) return state;
  if (state.chat.broadcastId === broadcast.id) {
    return { ...state, pickedBroadcast: broadcast };
  }
  exec({
    type: "pick-broadcast",
    pick: { broadcastId: broadcast.id, liveChatId: broadcast.liveChatId },
  });
  return {
    ...state,
    pickedBroadcast: broadcast,
    chat: {
      broadcastId: broadcast.id,
      connection: { state: "connecting" },
      messages: [],
    },
  };
};

/** The chat buffer follows what the app server's chat says. */
const chatHeard = (state: State, event: BroadcastChatEvent): State => {
  if (event.type === "chat-attached") {
    // The app server's pick wins: it is the chat being read.
    const id = event.chat.broadcastId;
    const pickedBroadcast =
      id === null || state.pickedBroadcast?.id === id
        ? state.pickedBroadcast
        : listedBroadcast(state, id);
    return { ...state, chat: event.chat, pickedBroadcast };
  }
  // A late word on a chat no longer picked.
  if (event.broadcastId !== state.chat.broadcastId) return state;
  if (event.type === "chat-connection-changed") {
    return { ...state, chat: { ...state.chat, connection: event.connection } };
  }
  return {
    ...state,
    chat: {
      ...state.chat,
      messages: [...state.chat.messages, ...event.messages].slice(
        -MAX_CHAT_MESSAGES
      ),
    },
  };
};

export const liveStreamReducer: EffectReducer<State, Action, Effect> = (
  state,
  action,
  exec
) => {
  switch (action.type) {
    case "broadcast-picker-shown":
      // A list already shown stays until Matt asks for a refresh.
      if (state.listing || state.broadcastList.status === "listed") {
        return state;
      }
      exec({ type: "list-broadcasts" });
      return { ...state, listing: true };
    case "refresh-broadcasts-clicked":
      if (state.listing) return state;
      exec({ type: "list-broadcasts" });
      return { ...state, listing: true };
    case "broadcasts-answered":
      return broadcastsAnswered(state, action.answer);
    case "broadcast-listing-failed":
      return {
        ...state,
        listing: false,
        broadcastList: { status: "failed", message: action.message },
      };
    case "broadcast-clicked":
      return broadcastClicked(state, action.broadcastId, exec);
    case "chat-attached":
    case "chat-message-received":
    case "chat-connection-changed":
      return chatHeard(state, action);
  }
};

export type BroadcastPickerRow = {
  broadcast: Broadcast;
  picked: boolean;
  /** Why Go Live will refuse it, or `null`. */
  refusal: string | null;
};

/** The picker's rows: every listed Broadcast, the picked one marked. */
export const broadcastPickerRows = (state: State): BroadcastPickerRow[] =>
  state.broadcastList.status === "listed"
    ? state.broadcastList.broadcasts.map((broadcast) => ({
        broadcast,
        picked: state.pickedBroadcast?.id === broadcast.id,
        refusal: broadcastRefusal(broadcast),
      }))
    : [];
