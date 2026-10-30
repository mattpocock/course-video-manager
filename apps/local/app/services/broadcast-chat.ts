import type {
  BroadcastChatEvent,
  BroadcastPick,
  ChatConnection,
  ChatMessage,
  ChatSnapshot,
} from "@/features/streaming/broadcast-chat";
import type { ChatPage, ChatYouTube } from "@/services/youtube-live-service";

/**
 * THE APP SERVER'S BROADCAST CHAT: the picked **Broadcast**'s live chat,
 * read from the pick until End Stream or another pick, whether or not a
 * Streaming tab listens, so leaving the tab loses nothing (spec #2445,
 * stories 63–68). It never runs in the recorder service.
 *
 * It reads chat on one `liveChatMessages.streamList` connection, which costs
 * 5 quota units however long it stays open; polling `list` would eat the
 * daily quota uploads share. A connection that drops is opened again on its
 * own, after a pause that doubles up to `maxReconnectMs`, from the last page
 * heard. Only a stream connection YouTube refuses falls back to `list`
 * polling, at the interval YouTube gives.
 *
 * It keeps the last `maxMessages` in memory for a listener that comes back;
 * chat messages are never stored.
 */

export type BroadcastChat = {
  /** Reads this Broadcast's chat instead; picking the same one again is a no-op. */
  pick: (pick: BroadcastPick) => void;
  /** End Stream: stop reading chat and forget it. */
  end: () => void;
  /** Hears `chat-attached` at once, then every change. */
  subscribe: (listener: (event: BroadcastChatEvent) => void) => () => void;
  snapshot: () => ChatSnapshot;
};

export const createBroadcastChat = (o: {
  youtube: ChatYouTube;
  /** The first pause before reconnecting a dropped connection. */
  reconnectMs: number;
  maxReconnectMs: number;
  maxMessages: number;
}): BroadcastChat => {
  const listeners = new Set<(event: BroadcastChatEvent) => void>();
  let broadcastId: string | null = null;
  let connection: ChatConnection = { state: "idle" };
  let messages: ChatMessage[] = [];
  let running: AbortController | null = null;

  const snapshot = (): ChatSnapshot => ({ broadcastId, connection, messages });
  const emit = (event: BroadcastChatEvent) => {
    for (const listener of listeners) listener(event);
  };

  const stop = () => {
    running?.abort();
    running = null;
  };

  const run = async (id: string, liveChatId: string, signal: AbortSignal) => {
    let pageToken: string | null = null;
    let pause = o.reconnectMs;
    let polling = false;

    const setConnection = (next: ChatConnection) => {
      if (signal.aborted) return;
      if (JSON.stringify(next) === JSON.stringify(connection)) return;
      connection = next;
      emit({ type: "chat-connection-changed", broadcastId: id, connection });
    };

    const hear = (page: ChatPage) => {
      if (signal.aborted) return;
      pageToken = page.nextPageToken ?? pageToken;
      pause = o.reconnectMs;
      const known = new Set(messages.map((m) => m.id));
      const fresh = page.messages.filter((m) => !known.has(m.id));
      if (fresh.length === 0) return;
      messages = [...messages, ...fresh].slice(-o.maxMessages);
      emit({ type: "chat-message-received", broadcastId: id, messages: fresh });
    };

    const reconnectAfterPause = async (message: string) => {
      setConnection({ state: "reconnecting", message });
      await sleep(pause, signal);
      pause = Math.min(pause * 2, o.maxReconnectMs);
    };

    while (!signal.aborted) {
      const asked = { liveChatId, pageToken, signal };
      const answer = await (
        polling ? o.youtube.listPage(asked) : o.youtube.openStream(asked)
      ).catch((e: unknown) => ({
        status: "dropped" as const,
        message: e instanceof Error ? e.message : String(e),
      }));
      if (signal.aborted) return;

      switch (answer.status) {
        case "open":
          setConnection({ state: "streaming" });
          try {
            for await (const page of answer.pages) hear(page);
            if (signal.aborted) return;
            await reconnectAfterPause("YouTube closed the chat connection.");
          } catch (e) {
            if (signal.aborted) return;
            await reconnectAfterPause(
              e instanceof Error ? e.message : String(e)
            );
          }
          break;
        case "page":
          setConnection({ state: "polling" });
          hear(answer.page);
          await sleep(answer.page.pollingIntervalMillis ?? pause, signal);
          break;
        case "refused":
          if (polling) {
            await reconnectAfterPause(answer.message);
          } else {
            // The only way into polling: YouTube won't stream this chat.
            polling = true;
          }
          break;
        case "dropped":
          await reconnectAfterPause(answer.message);
          break;
        case "over":
          setConnection({ state: "over", reason: answer.reason });
          return;
        case "needs-reconnect":
          setConnection({ state: "needs-reconnect", reason: answer.reason });
          return;
      }
    }
  };

  const attach = () => emit({ type: "chat-attached", chat: snapshot() });

  return {
    pick: (pick) => {
      if (pick.broadcastId === broadcastId) return;
      stop();
      broadcastId = pick.broadcastId;
      messages = [];
      if (pick.liveChatId === null) {
        connection = { state: "over", reason: "no-chat" };
        attach();
        return;
      }
      connection = { state: "connecting" };
      attach();
      const controller = new AbortController();
      running = controller;
      void run(pick.broadcastId, pick.liveChatId, controller.signal);
    },
    end: () => {
      stop();
      broadcastId = null;
      connection = { state: "idle" };
      messages = [];
      attach();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      listener({ type: "chat-attached", chat: snapshot() });
      return () => listeners.delete(listener);
    },
    snapshot,
  };
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });
