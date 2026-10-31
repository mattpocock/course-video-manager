import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { ChatSnapshot } from "@/features/streaming/broadcast-chat";
import { chatHighlightsUnavailable } from "@/services/card-browser.server";
import type { RecorderClient } from "./client.server";
import { RecorderCommandError, recorderCommand } from "./recorder-command";

/**
 * CHAT HIGHLIGHTS on the app server (spec #2445, stories 69–82): a chat
 * message shown on the Live Stream picture, or hidden. The message is taken
 * from the app server's own chat buffer, so the card shows (and the row
 * keeps) the author and text exactly as relayed. The recorder service stamps
 * each edge and logs it in the streamed Recording Session; saving it is the
 * ingest's (`ingest-chat-highlight.server.ts`), like every event.
 */

export const CHAT_MESSAGE_GONE =
  "That message is no longer in the Broadcast's chat.";

/** SHOW: the message's card on the picture, replacing any other. */
export const showChatHighlight = (o: {
  client: RecorderClient;
  chat: ChatSnapshot;
  videoId: string;
  messageId: string;
  /** The card server's browser (`cardBrowserPath`): without it, no card can be drawn. */
  cardBrowser: string | undefined;
}) =>
  Effect.gen(function* () {
    const unavailable = chatHighlightsUnavailable(o.cardBrowser);
    if (unavailable)
      return yield* new RecorderCommandError({
        message: unavailable,
        cause: null,
      });
    const message = o.chat.messages.find((m) => m.id === o.messageId);
    const broadcastId = o.chat.broadcastId;
    if (!message || !broadcastId)
      return yield* new RecorderCommandError({
        message: CHAT_MESSAGE_GONE,
        cause: null,
      });
    const highlightId = randomUUID();
    const answer = yield* recorderCommand(() =>
      o.client.showHighlight(o.videoId, {
        highlightId,
        broadcastId,
        messageId: message.id,
        author: message.author,
        text: message.text,
      })
    );
    return { highlightId, ...answer };
  });

/** HIDE: the card showing goes off the picture. */
export const hideChatHighlight = (
  client: RecorderClient,
  videoId: string,
  highlightId: string
) => recorderCommand(() => client.hideHighlight(videoId, highlightId));
