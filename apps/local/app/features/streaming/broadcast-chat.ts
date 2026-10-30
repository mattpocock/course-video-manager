import type { ReconnectReason } from "./broadcast";

/**
 * The picked **Broadcast**'s live chat, as the app server relays it to the
 * Streaming tab (`GET /api/streaming/chat/events`). The app server owns the
 * chat from the pick until End Stream or another pick (`services/
 * broadcast-chat.ts`); chat messages are never stored.
 */

/** One viewer's chat message, as YouTube shows it. */
export type ChatMessage = {
  /** YouTube's id for the message. */
  id: string;
  /** The author's display name. */
  author: string;
  /** The message text as YouTube displays it. */
  text: string;
  publishedAt: string;
};

/** Why YouTube will give no more chat for this Broadcast. */
export type ChatOverReason = "no-chat" | "ended" | "not-found" | "disabled";

/**
 * How the app server is reading the chat: `streaming` on one
 * `liveChatMessages.streamList` connection (5 quota units each), `polling`
 * `liveChatMessages.list` at YouTube's interval only once the stream
 * connection was refused, `reconnecting` after a dropped connection.
 */
export type ChatConnection =
  /** No Broadcast picked. */
  | { state: "idle" }
  | { state: "connecting" }
  | { state: "streaming" }
  | { state: "polling" }
  | { state: "reconnecting"; message: string }
  | { state: "over"; reason: ChatOverReason }
  | { state: "needs-reconnect"; reason: ReconnectReason };

/** Everything the app server holds of the chat, sent to each new listener. */
export type ChatSnapshot = {
  broadcastId: string | null;
  connection: ChatConnection;
  /** Oldest first, at most the app server's buffer. */
  messages: ChatMessage[];
};

/**
 * One SSE event from the app server's chat, named by its `type`. The
 * Streaming tab dispatches each to the Live Stream surface as is.
 */
export type BroadcastChatEvent =
  /** Sent first to each listener, and again on each pick and End Stream. */
  | { type: "chat-attached"; chat: ChatSnapshot }
  | {
      type: "chat-message-received";
      broadcastId: string;
      messages: ChatMessage[];
    }
  | {
      type: "chat-connection-changed";
      broadcastId: string;
      connection: ChatConnection;
    };

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
