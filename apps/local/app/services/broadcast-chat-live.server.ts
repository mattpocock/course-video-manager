import { createBroadcastChat, type BroadcastChat } from "./broadcast-chat";

/**
 * Where the app server keeps its one Broadcast chat, across dev-server module
 * reloads (a second would read the chat twice, and keep reading after End
 * Stream). Its reading runs on the pick's request's runtime
 * (`broadcast-chat.ts`), so this holds no runtime of its own.
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
    reconnectMs: 1_000,
    // Retry for ever, at least twice a minute, until End Stream.
    maxReconnectMs: 30_000,
    maxMessages: 500,
  });
  store[KEY] = chat;
  return chat;
};
