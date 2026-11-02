/**
 * Transport between the Streaming tab and its pop-out chat window (#2558),
 * built on `popup-channel.ts` like the teleprompter's. Its own channel name,
 * so no other popup parses its traffic.
 *
 * The Streaming tab is the source of truth: it hears the chat from the app
 * server and holds the Chat Highlight, and sends the window the chat as it
 * stands (`chatView`) on every change and in answer to every ping. The window
 * sends back only a clicked message, a fact the tab decides on.
 */
import { z } from "zod";
import { ChatView } from "@/features/streaming/chat-view";
import { createPopupChannel } from "./popup-channel";

export const StreamChatToChild = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat-view"), view: ChatView }),
]);
export type StreamChatToChild = z.infer<typeof StreamChatToChild>;

export const StreamChatToParent = z.discriminatedUnion("type", [
  /** Every 2 s while open: liveness, and a request for the chat. */
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("chat-message-clicked"), messageId: z.string() }),
]);
export type StreamChatToParent = z.infer<typeof StreamChatToParent>;

export const streamChatChannel = createPopupChannel({
  name: "cvm-stream-chat",
  url: "/stream-chat",
  windowFeatures: "popup,width=480,height=900",
  toChild: StreamChatToChild,
  toParent: StreamChatToParent,
});
