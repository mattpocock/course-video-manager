import { Schema } from "effect";
import type { ReconnectReason } from "./broadcast";

/**
 * The picked **Broadcast**'s live chat, as the app server relays it to the
 * Streaming tab (`GET /api/streaming/chat/events`). The app server owns the
 * chat from the pick until End Stream or another pick (`services/
 * broadcast-chat.ts`); chat messages are never stored.
 */

/** One viewer's chat message, as YouTube shows it. */
export const ChatMessage = Schema.Struct({
  /** YouTube's id for the message. */
  id: Schema.String,
  /** The author's display name. */
  author: Schema.String,
  /** The message text as YouTube displays it. */
  text: Schema.String,
  publishedAt: Schema.String,
});
export type ChatMessage = typeof ChatMessage.Type;

/** Why YouTube will give no more chat for this Broadcast. */
const ChatOverReason = Schema.Literal(
  "no-chat",
  "ended",
  "not-found",
  "disabled"
);
export type ChatOverReason = typeof ChatOverReason.Type;

const ReconnectReason = Schema.Literal(
  "not-connected",
  "missing-live-access"
) satisfies Schema.Schema<ReconnectReason>;

/**
 * How the app server is reading the chat: `streaming` on one
 * `liveChatMessages.streamList` connection (5 quota units each), `polling`
 * `liveChatMessages.list` at YouTube's interval only once a stream
 * connection that worked is refused mid-stream (asking for the stream again
 * meanwhile), `reconnecting` after a dropped connection, `refused` when the
 * stream connection was refused before it ever opened.
 */
export const ChatConnection = Schema.Union(
  /** No Broadcast picked. */
  Schema.Struct({ state: Schema.Literal("idle") }),
  Schema.Struct({ state: Schema.Literal("connecting") }),
  Schema.Struct({ state: Schema.Literal("streaming") }),
  Schema.Struct({ state: Schema.Literal("polling") }),
  Schema.Struct({
    state: Schema.Literal("reconnecting"),
    message: Schema.String,
  }),
  /**
   * YouTube refused the stream connection before it ever opened for this
   * Broadcast: no chat is read, and none is polled, until another pick.
   */
  Schema.Struct({ state: Schema.Literal("refused"), message: Schema.String }),
  Schema.Struct({ state: Schema.Literal("over"), reason: ChatOverReason }),
  Schema.Struct({
    state: Schema.Literal("needs-reconnect"),
    reason: ReconnectReason,
  })
);
export type ChatConnection = typeof ChatConnection.Type;

/** Everything the app server holds of the chat, sent to each new listener. */
export const ChatSnapshot = Schema.Struct({
  broadcastId: Schema.NullOr(Schema.String),
  connection: ChatConnection,
  /** Oldest first, at most the app server's buffer. */
  messages: Schema.mutable(Schema.Array(ChatMessage)),
});
export type ChatSnapshot = typeof ChatSnapshot.Type;

/**
 * One SSE event from the app server's chat, named by its `type`. The
 * Streaming tab checks each against this, then dispatches it to the Live
 * Stream surface as is.
 */
export const BroadcastChatEvent = Schema.Union(
  /** Sent first to each listener, and again on each pick and End Stream. */
  Schema.Struct({ type: Schema.Literal("chat-attached"), chat: ChatSnapshot }),
  Schema.Struct({
    type: Schema.Literal("chat-message-received"),
    broadcastId: Schema.String,
    messages: Schema.mutable(Schema.Array(ChatMessage)),
  }),
  Schema.Struct({
    type: Schema.Literal("chat-connection-changed"),
    broadcastId: Schema.String,
    connection: ChatConnection,
  })
);
export type BroadcastChatEvent = typeof BroadcastChatEvent.Type;

export const BROADCAST_CHAT_EVENT_TYPES = [
  "chat-attached",
  "chat-message-received",
  "chat-connection-changed",
] as const satisfies readonly BroadcastChatEvent["type"][];

/** What `POST /api/streaming/broadcast-pick` takes. */
export type BroadcastPick = {
  broadcastId: string;
  liveChatId: string | null;
};
