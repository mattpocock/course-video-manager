import type { StreamChatToParent } from "@/lib/stream-chat-protocol";
import type { ChatHighlightAction } from "./chat-highlight-reducer";

/**
 * What the Streaming tab does with a message from its pop-out chat window
 * (#2558, `lib/stream-chat-protocol.ts`): answer a ping with the chat as it
 * stands, or take a clicked message as its own click — the pop-out opens no
 * connection to the app server, so its Chat Highlight clicks come this way.
 */
export type StreamChatBridgeStep =
  | { type: "send-chat-view" }
  | { type: "dispatch"; action: ChatHighlightAction };

export const streamChatBridgeStep = (
  message: StreamChatToParent,
  videoId: string
): StreamChatBridgeStep => {
  switch (message.type) {
    case "ping":
      return { type: "send-chat-view" };
    case "chat-message-clicked":
      return {
        type: "dispatch",
        action: {
          type: "chat-message-clicked",
          videoId,
          messageId: message.messageId,
        },
      };
  }
};
