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
    // While polling, ask for the stream connection again at least once a
    // minute: a refused ask costs about what one poll does, so at YouTube's
    // usual few-second polling interval it adds under a tenth to the polling,
    // and polling outlives the stream's return by a minute at most.
    maxStreamRetryMs: 60_000,
    // YouTube holds a healthy stream connection open for minutes; one it
    // closes within a minute is reopened after a growing pause.
    steadyMs: 60_000,
    maxMessages: 500,
    // One line per change, into the dev log, so a run can tell polling from
    // flapping (#2558).
    log: (entry) =>
      console.log(
        `[broadcast-chat] ${JSON.stringify({ at: new Date().toISOString(), ...entry })}`
      ),
  });
  store[KEY] = chat;
  return chat;
};
