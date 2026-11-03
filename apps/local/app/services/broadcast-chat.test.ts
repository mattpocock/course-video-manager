import { describe, it, expect } from "@effect/vitest";
import { afterEach, vi } from "vitest";
import type http from "node:http";
import {
  createBroadcastChat,
  type ChatConnectionLog,
  type BroadcastChat,
} from "@/services/broadcast-chat";
import type { BroadcastChatEvent } from "@/features/streaming/broadcast-chat";
import {
  holdOpen,
  useFakeYouTube,
  youtube,
} from "@/test-utils/fake-youtube-live";

/**
 * The picked Broadcast's live chat, read by the app server from a YouTube
 * faked at the HTTP boundary (`fake-youtube-live.ts`). No test reaches Google.
 */

const { storeGrant, runWithFakeYouTube } = useFakeYouTube();

/** One `liveChatMessageListResponse` page, as YouTube sends it. */
const chatPage = (o: {
  messages: { id: string; author: string; text: string }[];
  nextPageToken?: string;
  pollingIntervalMillis?: number;
}) => ({
  kind: "youtube#liveChatMessageListResponse",
  nextPageToken: o.nextPageToken,
  pollingIntervalMillis: o.pollingIntervalMillis,
  items: o.messages.map((m) => ({
    kind: "youtube#liveChatMessage",
    id: m.id,
    snippet: {
      type: "textMessageEvent",
      displayMessage: m.text,
      publishedAt: "2026-10-30T18:00:00Z",
    },
    authorDetails: { displayName: m.author },
  })),
});

/**
 * Sends pages on an open stream connection the way YouTube frames a
 * server-streamed REST answer: one JSON array, an element at a time.
 */
const sendPages = (
  res: http.ServerResponse,
  pages: ReturnType<typeof chatPage>[]
) => {
  for (const page of pages) {
    const first = !youtube.openStreams.includes(res);
    if (first) holdOpen(res);
    const already = (res as { pagesSent?: number }).pagesSent ?? 0;
    res.write(`${already === 0 ? "" : ",\r\n"}${JSON.stringify(page)}`);
    (res as { pagesSent?: number }).pagesSent = already + 1;
  }
};

const fakeViewerMessage = (n: number) => ({
  id: `msg-${n}`,
  author: `@fake_viewer_${n}`,
  text: `Fake question number ${n}`,
});

/** YouTube refusing a stream connection: a 4xx that isn't scope or chat-over. */
const refuseStream = (res: http.ServerResponse) => {
  res.writeHead(403, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: { code: 403, message: "Forbidden" } }));
};

const shown = (n: number) => ({
  id: `msg-${n}`,
  author: `@fake_viewer_${n}`,
  text: `Fake question number ${n}`,
  publishedAt: "2026-10-30T18:00:00Z",
});

const chatRequests = () =>
  youtube.requests
    .filter((r) => r.path.startsWith("/youtube/v3/liveChat/"))
    .map((r) => new URL(r.path, "http://fake"));

/** The app server's chat, talking to the fake YouTube. */
let chats: BroadcastChat[] = [];
const startChat = (
  o: Partial<Parameters<typeof createBroadcastChat>[0]> = {}
) => {
  const chat = createBroadcastChat({
    reconnectMs: 20,
    maxReconnectMs: 100,
    maxStreamRetryMs: 100,
    steadyMs: 10,
    maxMessages: 500,
    ...o,
  });
  chats.push(chat);
  return chat;
};

afterEach(() => {
  for (const chat of chats) chat.end();
  chats = [];
});

/** Picks a Broadcast as the pick route does: its reading runs on the fake YouTube. */
const pick = (chat: BroadcastChat, p: Parameters<BroadcastChat["pick"]>[0]) =>
  runWithFakeYouTube(chat.pick(p));

/** What a Streaming tab listening from now on hears. */
const listen = (chat: BroadcastChat) => {
  const heard: BroadcastChatEvent[] = [];
  chat.subscribe((event) => heard.push(event));
  return heard;
};

const messagesHeard = (heard: BroadcastChatEvent[]) =>
  heard.flatMap((e) =>
    e.type === "chat-message-received"
      ? e.messages
      : e.type === "chat-attached"
        ? e.chat.messages
        : []
  );

describe("the Broadcast's live chat, owned by the app server", () => {
  it("streams the picked Broadcast's chat from the pick, new messages arriving as they're posted, and a Streaming tab that comes back hears what was posted while it was away", async () => {
    await storeGrant();
    let connection: http.ServerResponse | undefined;
    youtube.chatStreams.push((res) => {
      connection = res;
      sendPages(res, [
        chatPage({ messages: [fakeViewerMessage(1)], nextPageToken: "t1" }),
      ]);
    });
    const chat = startChat();
    const heard = listen(chat);

    await pick(chat, {
      broadcastId: "office-hours",
      liveChatId: "chat-office-hours",
    });

    await vi.waitFor(() => expect(messagesHeard(heard)).toEqual([shown(1)]));
    sendPages(connection!, [
      chatPage({ messages: [fakeViewerMessage(2)], nextPageToken: "t2" }),
    ]);
    await vi.waitFor(() =>
      expect(messagesHeard(heard)).toEqual([shown(1), shown(2)])
    );

    expect(chat.snapshot()).toEqual({
      broadcastId: "office-hours",
      connection: { state: "streaming" },
      messages: [shown(1), shown(2)],
    });
    // One streamList connection, not polling: 5 quota units for the lot.
    const [request, ...others] = chatRequests();
    expect(others).toEqual([]);
    expect(request!.pathname).toBe("/youtube/v3/liveChat/messages/stream");
    expect(request!.searchParams.get("liveChatId")).toBe("chat-office-hours");
    expect(request!.searchParams.get("part")).toBe("snippet,authorDetails");
    expect(
      youtube.requests.every(
        (r) => r.authorization === "Bearer stored-access-token"
      )
    ).toBe(true);
    // A tab that listens only now hears everything kept, at once.
    expect(listen(chat)).toEqual([
      {
        type: "chat-attached",
        chat: {
          broadcastId: "office-hours",
          connection: { state: "streaming" },
          messages: [shown(1), shown(2)],
        },
      },
    ]);
  });

  it("reconnects on its own when the stream connection drops, from where it left off", async () => {
    await storeGrant();
    youtube.chatStreams.push((res) => {
      sendPages(res, [
        chatPage({ messages: [fakeViewerMessage(1)], nextPageToken: "t1" }),
      ]);
      setTimeout(() => res.destroy(), 20);
    });
    youtube.chatStreams.push((res) =>
      sendPages(res, [
        chatPage({ messages: [fakeViewerMessage(2)], nextPageToken: "t2" }),
      ])
    );
    const chat = startChat();
    const heard = listen(chat);

    await pick(chat, {
      broadcastId: "office-hours",
      liveChatId: "chat-office-hours",
    });

    await vi.waitFor(() =>
      expect(messagesHeard(heard)).toEqual([shown(1), shown(2)])
    );
    expect(
      chatRequests().map((r) => [r.pathname, r.searchParams.get("pageToken")])
    ).toEqual([
      ["/youtube/v3/liveChat/messages/stream", null],
      ["/youtube/v3/liveChat/messages/stream", "t1"],
    ]);
    expect(
      heard.flatMap((e) =>
        e.type === "chat-connection-changed" ? [e.connection.state] : []
      )
    ).toEqual(["streaming", "reconnecting", "streaming"]);
  });

  it("reopens a stream connection YouTube ends cleanly from where it left off, still streaming: an end isn't a drop", async () => {
    await storeGrant();
    // YouTube answers with a page, then ends its answer: it does so every
    // few seconds on a healthy chat.
    youtube.chatStreams.push((res) => {
      sendPages(res, [
        chatPage({ messages: [fakeViewerMessage(1)], nextPageToken: "t1" }),
      ]);
      setTimeout(() => res.end("]"), 5);
    });
    youtube.chatStreams.push((res) =>
      sendPages(res, [
        chatPage({ messages: [fakeViewerMessage(2)], nextPageToken: "t2" }),
      ])
    );
    const chat = startChat();
    const heard = listen(chat);

    await pick(chat, {
      broadcastId: "office-hours",
      liveChatId: "chat-office-hours",
    });

    await vi.waitFor(() =>
      expect(messagesHeard(heard)).toEqual([shown(1), shown(2)])
    );
    expect(chatRequests().map((r) => r.searchParams.get("pageToken"))).toEqual([
      null,
      "t1",
    ]);
    expect(
      heard.flatMap((e) =>
        e.type === "chat-connection-changed" ? [e.connection.state] : []
      )
    ).toEqual(["streaming"]);
  });

  it("reopens at once each time YouTube ends an answer after pages, so chat is never held back by a pause", async () => {
    await storeGrant();
    const endedAt: number[] = [];
    let page = 0;
    // A healthy chat: YouTube answers each connection with a page, then
    // ends the answer, over and over.
    const answer = (res: http.ServerResponse) => {
      page += 1;
      sendPages(res, [
        chatPage({
          messages: [fakeViewerMessage(page)],
          nextPageToken: `t${page}`,
        }),
      ]);
      setTimeout(() => {
        endedAt.push(Date.now());
        res.end("]");
      }, 5);
      if (page < 6) youtube.chatStreams.push(answer);
    };
    youtube.chatStreams.push(answer);
    const heardAt: number[] = [];
    // Pauses this long would hold each message back hundreds of ms.
    const chat = startChat({
      reconnectMs: 200,
      maxReconnectMs: 1_000,
      steadyMs: 10_000,
    });
    chat.subscribe((e) => {
      if (e.type === "chat-message-received") heardAt.push(Date.now());
    });

    await pick(chat, {
      broadcastId: "office-hours",
      liveChatId: "chat-office-hours",
    });

    await vi.waitFor(() => expect(heardAt).toHaveLength(6), {
      timeout: 3000,
    });
    // From YouTube ending one answer to the next message heard.
    const latencies = heardAt.slice(1).map((at, i) => at - endedAt[i]!);
    expect(latencies.every((ms) => ms < 100)).toBe(true);
    expect(chatRequests().map((r) => r.searchParams.get("pageToken"))).toEqual([
      null,
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
    ]);
  });

  it("reopens a stream YouTube keeps ending with no chat after a growing pause, and logs each open with the opens so far", async () => {
    await storeGrant();
    // YouTube opens every stream connection, then ends it with no page.
    const flap = (res: http.ServerResponse) => {
      holdOpen(res);
      setTimeout(() => res.end("]"), 5);
      youtube.chatStreams.push(flap);
    };
    youtube.chatStreams.push(flap);
    const logged: ChatConnectionLog[] = [];
    const chat = startChat({
      reconnectMs: 20,
      maxReconnectMs: 160,
      steadyMs: 10_000,
      log: (entry) => logged.push(entry),
    });

    await pick(chat, {
      broadcastId: "office-hours",
      liveChatId: "chat-office-hours",
    });
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Pauses of 20, 40, 80, 160, 160… ms: about six opens in 0.6 s, where a
    // pause that started over at 20 ms would open about twenty.
    const opens = chatRequests().length;
    expect(opens).toBeGreaterThanOrEqual(4);
    expect(opens).toBeLessThanOrEqual(8);
    expect(logged.slice(0, 3)).toEqual([
      {
        broadcastId: "office-hours",
        connection: { state: "streaming" },
        streamOpens: 1,
      },
      {
        broadcastId: "office-hours",
        connection: { state: "streaming" },
        streamOpens: 2,
      },
      {
        broadcastId: "office-hours",
        connection: { state: "streaming" },
        streamOpens: 3,
      },
    ]);
  });

  it("never polls when YouTube refuses the stream connection from the start: the chat shows why", async () => {
    await storeGrant();
    youtube.chatStreams.push(refuseStream);
    youtube.chatPolls.push({
      status: 200,
      body: chatPage({ messages: [fakeViewerMessage(1)] }),
    });
    const chat = startChat();
    const heard = listen(chat);

    await pick(chat, {
      broadcastId: "office-hours",
      liveChatId: "chat-office-hours",
    });

    await vi.waitFor(() =>
      expect(chat.snapshot().connection).toEqual({
        state: "refused",
        message: "YouTube answered 403: Forbidden",
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(chatRequests().map((r) => r.pathname)).toEqual([
      "/youtube/v3/liveChat/messages/stream",
    ]);
    expect(heard.at(-1)).toEqual({
      type: "chat-connection-changed",
      broadcastId: "office-hours",
      connection: {
        state: "refused",
        message: "YouTube answered 403: Forbidden",
      },
    });
  });

  it("starts again when its Broadcast is picked again once it gave up (refused, Google to reconnect, over); a chat still running is left alone", async () => {
    await storeGrant();
    youtube.chatStreams.push(refuseStream);
    youtube.chatStreams.push((res) =>
      sendPages(res, [chatPage({ messages: [fakeViewerMessage(1)] })])
    );
    const chat = startChat();
    const officeHours = {
      broadcastId: "office-hours",
      liveChatId: "chat-office-hours",
    };

    await pick(chat, officeHours);
    await vi.waitFor(() =>
      expect(chat.snapshot().connection.state).toBe("refused")
    );
    // Matt clicks it again (after reconnecting Google, say).
    await pick(chat, officeHours);

    await vi.waitFor(() =>
      expect(chat.snapshot().messages).toEqual([shown(1)])
    );
    await pick(chat, officeHours);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(chatRequests()).toHaveLength(2);
    expect(chat.snapshot().messages).toEqual([shown(1)]);
  });

  it("polls, at YouTube's interval, only once a stream connection that worked breaks down mid-stream", async () => {
    await storeGrant();
    youtube.chatStreams.push((res) => {
      sendPages(res, [
        chatPage({ messages: [fakeViewerMessage(1)], nextPageToken: "t1" }),
      ]);
      setTimeout(() => res.destroy(), 20);
    });
    // Every stream connection from here on is refused.
    for (let i = 0; i < 20; i++) youtube.chatStreams.push(refuseStream);
    youtube.chatPolls.push(
      {
        status: 200,
        body: chatPage({
          messages: [fakeViewerMessage(2)],
          nextPageToken: "p1",
          pollingIntervalMillis: 300,
        }),
      },
      {
        status: 200,
        body: chatPage({
          messages: [fakeViewerMessage(3)],
          nextPageToken: "p2",
          pollingIntervalMillis: 300,
        }),
      }
    );
    const chat = startChat();
    const heard = listen(chat);
    const heardAt: number[] = [];
    chat.subscribe((e) => {
      if (e.type === "chat-message-received") heardAt.push(Date.now());
    });

    await pick(chat, {
      broadcastId: "office-hours",
      liveChatId: "chat-office-hours",
    });

    await vi.waitFor(() =>
      expect(messagesHeard(heard)).toEqual([shown(1), shown(2), shown(3)])
    );
    expect(
      chatRequests()
        .filter((r) => r.pathname === "/youtube/v3/liveChat/messages")
        .map((r) => r.searchParams.get("pageToken"))
    ).toEqual(["t1", "p1"]);
    expect(heardAt[2]! - heardAt[1]!).toBeGreaterThanOrEqual(280);
    expect(chat.snapshot().connection).toEqual({ state: "polling" });
  });

  it("while polling, asks for the stream connection again after a pause that doubles up to a cap, and stops polling the moment it's back", async () => {
    await storeGrant();
    const askedAt: number[] = [];
    youtube.chatStreams.push((res) => {
      sendPages(res, [
        chatPage({ messages: [fakeViewerMessage(1)], nextPageToken: "t1" }),
      ]);
      setTimeout(() => res.destroy(), 20);
    });
    // Refused as it breaks down, then five more times, then back.
    for (let i = 0; i < 6; i++) {
      youtube.chatStreams.push((res) => {
        askedAt.push(Date.now());
        refuseStream(res);
      });
    }
    youtube.chatStreams.push((res) => {
      askedAt.push(Date.now());
      sendPages(res, [chatPage({ messages: [fakeViewerMessage(9)] })]);
    });
    for (let i = 0; i < 200; i++) {
      youtube.chatPolls.push({
        status: 200,
        body: chatPage({ messages: [], pollingIntervalMillis: 5 }),
      });
    }
    const chat = startChat();

    await pick(chat, {
      broadcastId: "office-hours",
      liveChatId: "chat-office-hours",
    });

    await vi.waitFor(
      () => expect(chat.snapshot().messages).toEqual([shown(1), shown(9)]),
      { timeout: 3000 }
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(chat.snapshot().connection).toEqual({ state: "streaming" });
    const pauses = askedAt.slice(1).map((at, i) => at - askedAt[i]!);
    // 20, 40, 80, then the cap of 100 (doubling on would give 160, 320).
    expect(pauses.map((p, i) => p >= [20, 40, 80, 100, 100, 100][i]!)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(pauses.slice(3).every((p) => p < 150)).toBe(true);
    // Not one poll once the stream connection is back.
    const paths = chatRequests().map((r) => r.pathname);
    expect(paths.at(-1)).toBe("/youtube/v3/liveChat/messages/stream");
    expect(paths.filter((p) => p.endsWith("/stream"))).toHaveLength(8);
  });

  it("picking another Broadcast switches chat, and End Stream stops it", async () => {
    await storeGrant();
    let first: http.ServerResponse | undefined;
    youtube.chatStreams.push((res) => {
      first = res;
      sendPages(res, [chatPage({ messages: [fakeViewerMessage(1)] })]);
    });
    let second: http.ServerResponse | undefined;
    youtube.chatStreams.push((res) => {
      second = res;
      sendPages(res, [chatPage({ messages: [fakeViewerMessage(2)] })]);
    });
    const chat = startChat();
    await pick(chat, {
      broadcastId: "office-hours",
      liveChatId: "chat-office-hours",
    });
    await vi.waitFor(() => expect(chat.snapshot().messages).toHaveLength(1));
    const firstClosed = new Promise((resolve) => first!.on("close", resolve));

    await pick(chat, { broadcastId: "qa", liveChatId: "chat-qa" });

    await firstClosed;
    await vi.waitFor(() =>
      expect(chat.snapshot()).toEqual({
        broadcastId: "qa",
        connection: { state: "streaming" },
        messages: [shown(2)],
      })
    );

    const heard = listen(chat);
    const secondClosed = new Promise((resolve) => second!.on("close", resolve));
    chat.end();
    await secondClosed;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(heard.at(-1)).toEqual({
      type: "chat-attached",
      chat: { broadcastId: null, connection: { state: "idle" }, messages: [] },
    });
    expect(chatRequests().map((r) => r.searchParams.get("liveChatId"))).toEqual(
      ["chat-office-hours", "chat-qa"]
    );
  });
});
