import { z } from "zod";
import type { ChatConnection, ChatOverReason } from "./broadcast-chat";
import { chatRows } from "./chat-highlight-reducer";
import { liveSinceOf, type liveStreamReducer } from "./live-stream-reducer";

/**
 * THE CHAT VIEW (#2558): everything the live chat panel draws, as plain data,
 * so the Streaming tab and its pop-out window (`lib/stream-chat-protocol.ts`)
 * draw the same chat. The Streaming tab works it out from the Live Stream
 * surface; the pop-out only receives it (`popoutChatView`), without a word of
 * the connection's trouble, since Matt shows it to his audience.
 */
export const ChatView = z.object({
  /** A line about the chat connection, or `null` while it simply streams. */
  line: z.object({ text: z.string(), warn: z.boolean() }).nullable(),
  /** Warnings under it: why Chat Highlights can't show, why a click did nothing. */
  notices: z.array(z.string()),
  /** The chat streams but nobody has written yet. */
  waiting: z.boolean(),
  /**
   * The Broadcast's **Concurrent Viewers**, in words ("1,234 watching"), or
   * null while YouTube gives no count. The pop-out shows it too.
   */
  viewers: z.string().nullable(),
  /**
   * The Live Timer's start (ISO), while the Live Stream is on; else null.
   * The pop-out draws the Live Timer from it (`live-timer.ts`).
   */
  liveSince: z.string().nullable(),
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
      // Quiet: it retries on its own, and it only shows once it has lasted.
      if (!reconnectShown) return null;
      return { text: "Reconnecting to chat…", warn: false };
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

const viewersWords = (concurrentViewers: number | null) =>
  concurrentViewers === null
    ? null
    : `${concurrentViewers.toLocaleString("en-GB")} watching`;

/** What the pop-out says of the connection: never its trouble. */
const POPOUT_LINES: ReadonlySet<ChatConnection["state"]> = new Set([
  "idle",
  "connecting",
  "over",
]);

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
    viewers: viewersWords(state.concurrentViewers),
    liveSince: state.stream ? liveSinceOf(state, state.stream.videoId) : null,
    rows: chatRows(state).map(({ id, author, text, highlighted, pending }) => ({
      id,
      author,
      text,
      highlighted,
      pending,
    })),
  };
};

/**
 * The chat view for the pop-out window, which Matt shows his audience: the
 * same chat, but no word of the connection's trouble (reconnecting, polling,
 * refused, Google to reconnect). The Streaming tab still says it.
 */
export const popoutChatView = (
  state: liveStreamReducer.State,
  highlightsUnavailable: string | null
): ChatView => {
  const view = chatView(state, highlightsUnavailable);
  return POPOUT_LINES.has(state.chat.connection.state)
    ? view
    : { ...view, line: null };
};
