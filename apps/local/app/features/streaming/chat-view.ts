import { z } from "zod";
import type { ChatConnection, ChatOverReason } from "./broadcast-chat";
import { chatRows } from "./chat-highlight-reducer";
import type { liveStreamReducer } from "./live-stream-reducer";

/**
 * THE CHAT VIEW (#2558): everything the live chat panel draws, as plain data,
 * so the Streaming tab and its pop-out window (`lib/stream-chat-protocol.ts`)
 * draw the same thing. The Streaming tab works it out from the Live Stream
 * surface; the pop-out only receives it.
 */
export const ChatView = z.object({
  /** A line about the chat connection, or `null` while it simply streams. */
  line: z.object({ text: z.string(), warn: z.boolean() }).nullable(),
  /** Warnings under it: why Chat Highlights can't show, why a click did nothing. */
  notices: z.array(z.string()),
  /** The chat streams but nobody has written yet. */
  waiting: z.boolean(),
  rows: z.array(
    z.object({
      id: z.string(),
      author: z.string(),
      text: z.string(),
      /** On the stream picture now. */
      highlighted: z.boolean(),
      /** A click on it is out. */
      pending: z.boolean(),
    })
  ),
});
export type ChatView = z.infer<typeof ChatView>;

const OVER_MESSAGES: Record<ChatOverReason, string> = {
  "no-chat": "This Broadcast has no live chat.",
  ended: "This Broadcast's chat has ended.",
  "not-found": "YouTube can't find this Broadcast's chat.",
  disabled: "Chat is turned off for this Broadcast.",
};

const connectionLine = (
  connection: ChatConnection,
  /** The reconnect has outlasted its grace (`RECONNECT_GRACE_MS`). */
  reconnectShown: boolean
): ChatView["line"] => {
  switch (connection.state) {
    case "idle":
      return { text: "Pick a Broadcast to see its live chat.", warn: false };
    case "connecting":
      return { text: "Connecting to chat…", warn: false };
    case "streaming":
      return null;
    case "polling":
      return {
        text: "Chat is being polled while YouTube's streaming connection is down. Messages still arrive.",
        warn: false,
      };
    case "reconnecting":
      if (!reconnectShown) return null;
      return {
        text: `Chat connection dropped, reconnecting: ${connection.message}`,
        warn: true,
      };
    case "refused":
      return {
        text: `YouTube refused the chat connection, so no chat is shown: ${connection.message}`,
        warn: true,
      };
    case "over":
      return { text: OVER_MESSAGES[connection.reason], warn: false };
    case "needs-reconnect":
      return {
        text: "Reconnect Google on the Streaming tab to read this Broadcast's chat.",
        warn: true,
      };
  }
};

export const chatView = (
  state: liveStreamReducer.State,
  /** Why Chat Highlights can't be shown this Go Live, if they can't. */
  highlightsUnavailable: string | null
): ChatView => {
  const { messages, connection } = state.chat;
  return {
    line: connectionLine(connection, state.chatReconnect.shown),
    notices: [highlightsUnavailable, state.highlight.error].filter(
      (n): n is string => n !== null
    ),
    waiting: messages.length === 0 && connection.state === "streaming",
    rows: chatRows(state).map(({ id, author, text, highlighted, pending }) => ({
      id,
      author,
      text,
      highlighted,
      pending,
    })),
  };
};
