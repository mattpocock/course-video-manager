import { runtimeLive } from "@/services/layer.server";
import { chatYouTube } from "@/services/youtube-live-service";
import { createBroadcastChat, type BroadcastChat } from "./broadcast-chat";

/**
 * Where the app server keeps its one Broadcast chat, across dev-server module
 * reloads (a second would read the chat twice, and keep reading after End
 * Stream).
 */
const KEY = Symbol.for("cvm.broadcast-chat");

/** The app server's one Broadcast chat, made on first use. */
export const broadcastChat = (): BroadcastChat => {
  const store = globalThis as unknown as Record<
    symbol,
    BroadcastChat | undefined
  >;
  const existing = store[KEY];
  if (existing) return existing;
  const chat = createBroadcastChat({
    youtube: chatYouTube((effect) => runtimeLive.runPromise(effect)),
    reconnectMs: 1_000,
    // Retry for ever, at least twice a minute, until End Stream.
    maxReconnectMs: 30_000,
    maxMessages: 500,
  });
  store[KEY] = chat;
  return chat;
};
