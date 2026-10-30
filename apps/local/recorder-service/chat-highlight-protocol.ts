/**
 * CHAT HIGHLIGHTS ON THE RECORDER'S WIRE (spec #2445, protocol 19): the two
 * commands, and the two Recording Session events that answer them.
 *
 * A Chat Highlight is a Broadcast chat message Matt showed on the Live
 * Stream picture. At most one shows: `show-highlight` while another shows
 * replaces it (its exit, then the new card's entrance). Both commands act on
 * the streamed Recording Session only, and never wait in the command queue:
 * a card's still takes a moment to render, and a scene switch or a Stop must
 * not wait behind it.
 *
 * Each edge is stamped when the card's first changed frame goes into the
 * Live Stream's composite, on the recorder's Windows clock (`atMs`, the clock
 * `t0Ms` is on; `fileTime` is the same moment in picture time), and logged in
 * the Recording Session's `events.jsonl`, so the app server stores it as any
 * other event, replays included. A highlight still showing when the
 * Recording Session stops is closed with the stop's time, before
 * `recording-stopped`.
 */

export type ChatHighlightCommand =
  | {
      type: "show-highlight";
      /** The app server's id for it: the Chat Highlight row's. */
      highlightId: string;
      broadcastId: string;
      /** YouTube's id of the chat message. */
      messageId: string;
      /** The author's display name and the text, as the card shows them. */
      author: string;
      text: string;
    }
  | { type: "hide-highlight"; highlightId: string };

export type ChatHighlightEvent =
  | {
      type: "chat-highlight-shown";
      highlightId: string;
      broadcastId: string;
      messageId: string;
      author: string;
      text: string;
      atMs: number;
      fileTime: number;
      /** When `show-highlight` reached the service, on the same clock. */
      receivedAtMs: number;
    }
  | {
      type: "chat-highlight-hidden";
      highlightId: string;
      atMs: number;
      fileTime: number;
    };

/** Why a Chat Highlight command is refused. */
export const CHAT_HIGHLIGHT_REFUSALS = {
  notLive: "There is no Live Stream to show a Chat Highlight on.",
  notShowing: "That Chat Highlight is not showing.",
} as const;
