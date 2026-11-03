import {
  Clock,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  Schedule,
} from "effect";
import type {
  BroadcastChatEvent,
  BroadcastPick,
  ChatConnection,
  ChatMessage,
  ChatSnapshot,
} from "@/features/streaming/broadcast-chat";
import { chatGaveUp } from "@/features/streaming/broadcast-chat";
import type { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import {
  listChatPage,
  openChatStream,
  readConcurrentViewers,
  type ChatListAnswer,
  type ChatPage,
  type ChatStreamAnswer,
} from "@/services/youtube-live-service";

/**
 * THE APP SERVER'S BROADCAST CHAT: the picked **Broadcast**'s live chat,
 * read from the pick until its streamed Recording Session ends (End Stream,
 * or ending on its own) or another pick, whether or not a Streaming tab
 * listens, so leaving the tab loses nothing (spec #2445, stories 63–68). It
 * never runs in the recorder service.
 *
 * It reads chat on one `liveChatMessages.streamList` connection, which costs
 * 5 quota units however long it stays open; polling `list` would eat the
 * daily quota uploads share. A connection that drops is opened again on its
 * own, from the last page heard, after a pause that doubles from
 * `reconnectMs` up to `maxReconnectMs` (`Schedule.exponential`). A
 * connection that heard a page and stayed open `steadyMs` starts the pause
 * over; one that breaks sooner, though it heard pages, is reopened after a
 * pause that doubles too, so a stream that flaps can't spend the quota at 5
 * units a reopen (#2558).
 *
 * YouTube ends a healthy stream connection's answer every few seconds. That
 * end is no drop: the chat stays `streaming` while it is reopened from the
 * last page, at once if the answer carried a page (Google's streamList
 * sample reconnects in a loop with no pause; its docs give no wait), after
 * the growing pause if it carried none. Only a connection that fails (a
 * network error, a 5xx, a rate limit, a read that breaks) is `reconnecting`.
 *
 * A stream connection YouTube refuses before one has ever opened for the
 * Broadcast reads no chat at all (`refused`): it never polls, to spare the
 * quota (Matt, 2026-10-31). Only one that worked, then is refused mid-stream,
 * falls back to `list` polling, waiting the interval YouTube gives on each
 * page. While polling it asks for the stream connection again after a pause
 * that doubles from `reconnectMs` up to `maxStreamRetryMs`, and stops polling
 * as soon as one opens.
 *
 * Each pick's reading is one daemon fiber, forked from the pick's request so
 * it runs with the app server's services; the next pick or `end` stops it.
 * It keeps the last `maxMessages` in memory for a listener that comes back;
 * chat messages are never stored.
 *
 * Every change of connection is logged (`log`), with how many stream
 * connections this pick has opened, so a run's log tells polling from
 * flapping.
 *
 * Given `concurrentViewersEveryMs`, it also reads the Broadcast's
 * **Concurrent Viewers** (`videos.list`, 1 quota unit) at the pick and that
 * often after, until the same stop as the chat, or YouTube says the
 * Broadcast ended (#2659). A read that fails keeps the count it had and says
 * nothing: the pop-out, which Matt's audience sees, shows the count too.
 */

/** One logged change of a pick's chat connection. */
export type ChatConnectionLog = {
  broadcastId: string;
  connection: ChatConnection;
  /** Stream connections opened for this pick so far: 5 quota units each. */
  streamOpens: number;
};

export type BroadcastChat = {
  /** Reads this Broadcast's chat instead; picking the same one again is a no-op. */
  pick: (
    pick: BroadcastPick
  ) => Effect.Effect<void, never, LinkAuthOperationsService>;
  /** The streamed Recording Session ended: stop reading chat and forget it. */
  end: () => void;
  /** Hears `chat-attached` at once, then every change. */
  subscribe: (listener: (event: BroadcastChatEvent) => void) => () => void;
  snapshot: () => ChatSnapshot;
};

/** A connection or poll that gave out: asked again after a pause. */
class ChatDropped extends Data.TaggedError("ChatDropped")<{
  readonly message: string;
  /** It heard a page first, so the pause starts over. */
  readonly heard: boolean;
}> {}

/** Where one step of reading leads: another step, or no more chat. */
type Next = "again" | "done";

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const sameConnection = (a: ChatConnection, b: ChatConnection) =>
  a.state === b.state &&
  ("message" in a ? a.message : null) === ("message" in b ? b.message : null) &&
  ("reason" in a ? a.reason : null) === ("reason" in b ? b.reason : null);

export const createBroadcastChat = (o: {
  /** The first pause before reconnecting a dropped connection. */
  reconnectMs: number;
  maxReconnectMs: number;
  /** The longest pause between asks for the stream connection while polling. */
  maxStreamRetryMs: number;
  /**
   * A stream connection open this long before it closed was steady: the
   * reopen pause starts over. One closed sooner doubles it.
   */
  steadyMs: number;
  maxMessages: number;
  /** Hears every change of connection. */
  log?: (entry: ChatConnectionLog) => void;
  /** How often to read the Concurrent Viewers; never read without it. */
  concurrentViewersEveryMs?: number;
}): BroadcastChat => {
  const listeners = new Set<(event: BroadcastChatEvent) => void>();
  let broadcastId: string | null = null;
  let connection: ChatConnection = { state: "idle" };
  let messages: ChatMessage[] = [];
  let concurrentViewers: number | null = null;
  /** Done once the pick's reading must stop. */
  let stopReading: Deferred.Deferred<void> | null = null;

  const snapshot = (): ChatSnapshot => ({ broadcastId, connection, messages });
  const emit = (event: BroadcastChatEvent) => {
    for (const listener of listeners) listener(event);
  };
  const attach = () => emit({ type: "chat-attached", chat: snapshot() });

  /** Reads the Concurrent Viewers every `everyMs` until YouTube says it ended. */
  const watchViewers = (id: string, everyMs: number) =>
    Effect.gen(function* () {
      for (;;) {
        const read = yield* Effect.either(readConcurrentViewers(id));
        // A failed read keeps the last count.
        if (read._tag === "Right") {
          const next = read.right.ended ? null : read.right.concurrentViewers;
          if (next !== concurrentViewers && broadcastId === id) {
            concurrentViewers = next;
            emit({
              type: "concurrent-viewers-changed",
              broadcastId: id,
              concurrentViewers: next,
            });
          }
          if (read.right.ended) return;
        }
        yield* Effect.sleep(Duration.millis(everyMs));
      }
    });

  const stop = () => {
    if (stopReading) Deferred.unsafeDone(stopReading, Exit.void);
    stopReading = null;
  };

  /** A pause that doubles from `reconnectMs`, never more than `maxReconnectMs`. */
  const reconnects = Schedule.exponential(Duration.millis(o.reconnectMs)).pipe(
    Schedule.union(Schedule.spaced(Duration.millis(o.maxReconnectMs)))
  );

  /** Reads one Broadcast's chat until no more will come. */
  const read = (id: string, liveChatId: string) => {
    let pageToken: string | null = null;
    /** A stream connection opened for this Broadcast: streamList works for it. */
    let streamed = false;
    /** Polling since the stream broke mid-stream: when to ask for it again. */
    let polling: { retryMs: number; retryAt: number } | null = null;
    /** Stream connections asked for, and when the last one opened. */
    let streamOpens = 0;
    let streamOpenedAt = 0;
    /** The pause before reopening a stream that closed after pages. */
    let reopenPauseMs = o.reconnectMs;
    const openStream = (asked: Parameters<typeof openChatStream>[0]) =>
      Effect.suspend(() => {
        streamOpens += 1;
        return openChatStream(asked);
      });
    /** Polls, and asks for the stream connection again `retryMs` from now. */
    const retryStreamLater = (retryMs: number) =>
      Effect.map(Clock.currentTimeMillis, (now): Next => {
        polling = { retryMs, retryAt: now + retryMs };
        return "again";
      });

    /**
     * The pause before reopening a stream that heard chat: it starts over if
     * the connection was steady, and grows if YouTube keeps closing it soon.
     */
    const reopenPause = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const steady = now - streamOpenedAt >= o.steadyMs;
      const pauseMs = steady ? o.reconnectMs : reopenPauseMs;
      reopenPauseMs = steady
        ? o.reconnectMs
        : Math.min(pauseMs * 2, o.maxReconnectMs);
      yield* Effect.sleep(Duration.millis(pauseMs));
      return "again" as Next;
    });
    const setConnection = (next: ChatConnection) => {
      if (sameConnection(next, connection)) {
        // A stream reopened while it still streams: logged, so a run's log
        // still counts the opens.
        if (next.state === "streaming") {
          o.log?.({ broadcastId: id, connection, streamOpens });
        }
        return;
      }
      connection = next;
      o.log?.({ broadcastId: id, connection, streamOpens });
      emit({ type: "chat-connection-changed", broadcastId: id, connection });
    };
    const hear = (page: ChatPage) => {
      pageToken = page.nextPageToken ?? pageToken;
      const known = new Set(messages.map((m) => m.id));
      const fresh = page.messages.filter((m) => !known.has(m.id));
      if (fresh.length === 0) return;
      messages = [...messages, ...fresh].slice(-o.maxMessages);
      emit({ type: "chat-message-received", broadcastId: id, messages: fresh });
    };
    const dropped = (message: string, heard = false) =>
      Effect.fail(new ChatDropped({ message, heard }));

    /** One stream connection, read until it ends, or one poll. */
    const step = Effect.scoped(
      Effect.gen(function* () {
        // Interrupted, it closes its connection.
        const controller = yield* Effect.acquireRelease(
          Effect.sync(() => new AbortController()),
          (c) => Effect.sync(() => c.abort())
        );
        const asked = { liveChatId, pageToken, signal: controller.signal };
        const now = yield* Clock.currentTimeMillis;
        const wasPolling = polling;
        if (wasPolling && now >= wasPolling.retryAt) {
          // Polling: is the stream connection back yet?
          const back = yield* openStream(asked).pipe(
            Effect.catchAll((e) =>
              Effect.succeed({ status: "dropped", message: e.message } as const)
            )
          );
          if (back.status === "refused" || back.status === "dropped") {
            return yield* retryStreamLater(
              Math.min(wasPolling.retryMs * 2, o.maxStreamRetryMs)
            );
          }
          if (back.status === "open") polling = null;
          return yield* answered(back);
        }
        const call: Effect.Effect<
          ChatStreamAnswer | ChatListAnswer,
          { message: string },
          LinkAuthOperationsService
        > = wasPolling ? listChatPage(asked) : openStream(asked);
        const answer = yield* call.pipe(
          Effect.catchAll((e) => dropped(e.message))
        );
        if (answer.status === "refused") {
          if (wasPolling) return yield* dropped(answer.message);
          if (!streamed) {
            // Refused from the start: no polling, which eats the quota.
            setConnection({ state: "refused", message: answer.message });
            return "done" satisfies Next;
          }
          // It worked, then broke down mid-stream: poll until it's back.
          return yield* retryStreamLater(o.reconnectMs);
        }
        return yield* answered(answer);
      })
    );

    /** What one answer from YouTube that isn't a refusal leads to. */
    const answered = (
      answer: Exclude<ChatStreamAnswer | ChatListAnswer, { status: "refused" }>
    ) =>
      Effect.gen(function* () {
        switch (answer.status) {
          case "open": {
            streamed = true;
            streamOpenedAt = yield* Clock.currentTimeMillis;
            setConnection({ state: "streaming" });
            let heard = false;
            // Each page as it comes. Interrupted mid-read, the scope's abort
            // ends the read (an async generator can't be returned mid-await).
            const pages = answer.pages[Symbol.asyncIterator]();
            for (;;) {
              const page = yield* Effect.tryPromise({
                try: () => pages.next(),
                catch: (e) => new ChatDropped({ message: messageOf(e), heard }),
              });
              if (page.done) break;
              heard = true;
              hear(page.value);
            }
            // YouTube ended its answer: it does so every few seconds on a
            // healthy chat, so this is no drop. The chat still streams while
            // it is reopened from the last page heard: at once, as Google's
            // streamList sample does, since a pause would hold chat back. An
            // answer that ended with no page reopens after a growing pause,
            // so a stream that flaps can't spend the quota.
            if (heard) {
              reopenPauseMs = o.reconnectMs;
              return "again" satisfies Next;
            }
            return yield* reopenPause;
          }
          case "page":
            setConnection({ state: "polling" });
            hear(answer.page);
            yield* Effect.sleep(
              Duration.millis(
                answer.page.pollingIntervalMillis ?? o.reconnectMs
              )
            );
            return "again" satisfies Next;
          case "dropped":
            return yield* dropped(answer.message);
          case "over":
            setConnection({ state: "over", reason: answer.reason });
            return "done" satisfies Next;
          case "needs-reconnect":
            setConnection({ state: "needs-reconnect", reason: answer.reason });
            return "done" satisfies Next;
        }
      });

    /** A step, asked again after a growing pause until it gets through. */
    const stepThrough = step.pipe(
      Effect.tapError((e) =>
        Effect.sync(() =>
          setConnection({ state: "reconnecting", message: e.message })
        )
      ),
      Effect.retry({ schedule: reconnects, while: (e) => !e.heard }),
      // It heard chat before it dropped: the pause starts over if it was
      // steady, and grows if YouTube keeps closing it.
      Effect.catchTag("ChatDropped", () => reopenPause)
    );

    return Effect.gen(function* () {
      let next: Next = "again";
      while (next === "again") next = yield* stepThrough;
    });
  };

  return {
    pick: (pick) =>
      Effect.gen(function* () {
        // A chat that gave up starts again; one still reading is left alone.
        if (pick.broadcastId === broadcastId && !chatGaveUp(connection)) return;
        stop();
        broadcastId = pick.broadcastId;
        messages = [];
        concurrentViewers = null;
        const stopped = yield* Deferred.make<void>();
        stopReading = stopped;
        if (o.concurrentViewersEveryMs !== undefined) {
          // Outlives the pick's request, like the chat; ends with it.
          yield* Effect.forkDaemon(
            Effect.raceFirst(
              watchViewers(pick.broadcastId, o.concurrentViewersEveryMs),
              Deferred.await(stopped)
            )
          );
        }
        if (pick.liveChatId === null) {
          connection = { state: "over", reason: "no-chat" };
          attach();
          return;
        }
        connection = { state: "connecting" };
        attach();
        // Outlives the pick's request: it reads until stopped.
        yield* Effect.forkDaemon(
          Effect.raceFirst(
            read(pick.broadcastId, pick.liveChatId),
            Deferred.await(stopped)
          )
        );
      }),
    end: () => {
      stop();
      broadcastId = null;
      connection = { state: "idle" };
      messages = [];
      concurrentViewers = null;
      attach();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      listener({ type: "chat-attached", chat: snapshot() });
      if (broadcastId !== null && concurrentViewers !== null) {
        listener({
          type: "concurrent-viewers-changed",
          broadcastId,
          concurrentViewers,
        });
      }
      return () => listeners.delete(listener);
    },
    snapshot,
  };
};
