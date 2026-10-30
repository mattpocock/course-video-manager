import type { EffectReducer } from "use-effect-reducer";
import {
  isStreamOn,
  type StreamStatus,
} from "recorder-service/stream-protocol";
import type { SilenceLength } from "@/silence-detection-constants";
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
 * holds the Broadcast picker, the picked **Broadcast** and its chat buffer,
 * and **Go Live** / **End Stream** with the Live Stream's status as the
 * recorder says it; later tickets add its health and the current Chat
 * Highlight (spec #2445). The app server reads the chat (`services/
 * broadcast-chat.ts`); this buffer is what the Streaming tab has heard of
 * it. Go Live is sent whatever is missing: the app server answers with every
 * reason that applies at once (ADR 0054).
 *
 * The Live Stream outlives the Streaming tab (ADR 0055): every page hears
 * it from the app server (`recorder-live-heard`), and the Live indicator
 * links back to its Streaming tab while it is on.
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
    /** The Live Stream, as the recorder last said, and the Video it is open for. */
    stream: { videoId: string; status: StreamStatus } | null;
    /** Go Live or End Stream was pressed and the app server has not answered. */
    pending: "going-live" | "ending" | null;
    /** Why the last Go Live or End Stream did not happen, until the next press. */
    refusal: string | null;
  };

  export type Action =
    /** The Streaming tab drew the Broadcast picker. */
    | { type: "broadcast-picker-shown" }
    | { type: "refresh-broadcasts-clicked" }
    | { type: "broadcasts-answered"; answer: BroadcastListAnswer }
    | { type: "broadcast-listing-failed"; message: string }
    | { type: "broadcast-clicked"; broadcastId: string }
    /** Heard from the app server's chat (`GET /api/streaming/chat/events`). */
    | BroadcastChatEvent
    /** The Streaming tab's recorder said the Live Stream's status (null: not open for it). */
    | {
        type: "stream-status-heard";
        videoId: string;
        status: StreamStatus | null;
      }
    /** Any page heard the recorder's Live Stream from the app server (null: closed). */
    | {
        type: "recorder-live-heard";
        stream: { videoId: string; status: StreamStatus } | null;
      }
    | { type: "go-live-pressed"; videoId: string; silenceLength: SilenceLength }
    | { type: "go-live-answered" }
    | { type: "go-live-refused"; message: string }
    | { type: "end-stream-pressed"; videoId: string }
    | { type: "end-stream-answered" }
    | { type: "end-stream-failed"; message: string };

  export type Effect =
    | { type: "list-broadcasts" }
    /** The app server reads this Broadcast's chat from now on. */
    | { type: "pick-broadcast"; pick: BroadcastPick }
    /** Start a streamed Recording Session and its Live Stream on `videoId`. */
    | {
        type: "go-live";
        videoId: string;
        broadcastId: string | null;
        silenceLength: SilenceLength;
      }
    | { type: "end-stream"; videoId: string };
}

type State = liveStreamReducer.State;
type Action = liveStreamReducer.Action;
type Effect = liveStreamReducer.Effect;

export const createInitialLiveStreamState = (): State => ({
  broadcastList: { status: "unlisted" },
  listing: false,
  pickedBroadcast: null,
  stream: null,
  pending: null,
  refusal: null,
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

/** Whether the Live Stream on `videoId` is running: from Go Live until it ended. */
export const isLiveOn = (state: State, videoId: string) =>
  state.stream?.videoId === videoId && isStreamOn(state.stream.status);

/** The Live indicator every page shows while live, linking back to its Streaming tab. */
export type LiveIndicator = { videoId: string; href: string; words: string };

export const liveIndicator = (state: State): LiveIndicator | null => {
  const stream = state.stream;
  if (!stream || !isStreamOn(stream.status)) return null;
  return {
    videoId: stream.videoId,
    href: `/streaming/${stream.videoId}`,
    words: STATUS_WORDS[stream.status.kind] ?? "Live",
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
    case "recorder-live-heard":
      return { ...state, stream: action.stream };
    case "stream-status-heard":
    case "go-live-pressed":
    case "go-live-answered":
    case "end-stream-answered":
    case "go-live-refused":
    case "end-stream-failed":
    case "end-stream-pressed":
      return goLiveReducer(state, action, exec);
  }
};

/** Go Live and End Stream: one press out at a time, the answer shown. */
const goLiveReducer = (
  state: State,
  action: Extract<
    Action,
    {
      type:
        | "stream-status-heard"
        | "go-live-pressed"
        | "go-live-answered"
        | "end-stream-answered"
        | "go-live-refused"
        | "end-stream-failed"
        | "end-stream-pressed";
    }
  >,
  exec: (effect: Effect) => void
): State => {
  switch (action.type) {
    case "stream-status-heard":
      if (action.status !== null)
        return {
          ...state,
          stream: { videoId: action.videoId, status: action.status },
        };
      // A tab the recorder is not open for says nothing of another Video's.
      return state.stream?.videoId === action.videoId
        ? { ...state, stream: null }
        : state;
    case "go-live-pressed":
      if (state.pending || isLiveOn(state, action.videoId)) return state;
      exec({
        type: "go-live",
        videoId: action.videoId,
        broadcastId: state.pickedBroadcast?.id ?? null,
        silenceLength: action.silenceLength,
      });
      return { ...state, pending: "going-live", refusal: null };
    case "go-live-answered":
    case "end-stream-answered":
      return { ...state, pending: null };
    case "go-live-refused":
    case "end-stream-failed":
      return { ...state, pending: null, refusal: action.message };
    case "end-stream-pressed":
      if (state.pending || !isLiveOn(state, action.videoId)) return state;
      exec({ type: "end-stream", videoId: action.videoId });
      return { ...state, pending: "ending", refusal: null };
  }
};

/** The Streaming tab's one main button, and what it says under it. */
export type GoLiveControl = {
  /** What a press does: the button reads Go Live or End Stream. */
  press: "go-live" | "end-stream";
  /** A press is out: the button waits. */
  busy: boolean;
  /** The Live Stream's state in words, or null before any Go Live. */
  status: string | null;
  refusal: string | null;
};

const STATUS_WORDS: Record<StreamStatus["kind"], string | null> = {
  idle: null,
  starting: "Starting the Live Stream…",
  connecting: "Connecting to YouTube…",
  live: "Live",
  reconnecting: "Reconnecting to YouTube…",
  ended: null,
};

export const goLiveControl = (state: State, videoId: string): GoLiveControl => {
  const status = state.stream?.videoId === videoId ? state.stream.status : null;
  return {
    press: isLiveOn(state, videoId) ? "end-stream" : "go-live",
    busy: state.pending !== null,
    status:
      status?.kind === "ended"
        ? `The Live Stream ended: ${status.reason}`
        : status
          ? STATUS_WORDS[status.kind]
          : null,
    refusal: state.refusal,
  };
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
