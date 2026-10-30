import { describe, it, expect } from "@effect/vitest";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { ConfigProvider, Effect, Layer } from "effect";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { chatYouTube, listBroadcasts } from "@/services/youtube-live-service";
import {
  createBroadcastChat,
  type BroadcastChat,
} from "@/services/broadcast-chat";
import type { BroadcastChatEvent } from "@/features/streaming/broadcast-chat";

/**
 * The Broadcast list through the app server: the stored Google grant in the
 * test database, and YouTube faked at the HTTP boundary through the YouTube
 * API URL override. No test reaches Google.
 */

let testDb: TestDb;
let testLayer: Layer.Layer<LinkAuthOperationsService | DrizzleService>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  testLayer = LinkAuthOperationsService.Default.pipe(
    Layer.provideMerge(drizzleLayer)
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

type Answer = { status: number; body: unknown };

/**
 * A fake YouTube Data API: answers `liveBroadcasts` per `broadcastStatus`;
 * hands each `liveChat/messages/stream` connection to the next scripted
 * handler (holding it open when none is left), and each `liveChat/messages`
 * poll to the next scripted answer.
 */
let youtube: {
  url: string;
  requests: { path: string; authorization: string | undefined }[];
  answers: Record<string, Answer>;
  chatStreams: ((res: http.ServerResponse) => void)[];
  chatPolls: Answer[];
  /** Every stream connection YouTube holds open, newest last. */
  openStreams: http.ServerResponse[];
};
let server: http.Server;

beforeAll(async () => {
  youtube = {
    url: "",
    requests: [],
    answers: {},
    chatStreams: [],
    chatPolls: [],
    openStreams: [],
  };
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    youtube.requests.push({
      path: url.pathname + url.search,
      authorization: req.headers.authorization,
    });
    if (url.pathname === "/youtube/v3/liveChat/messages/stream") {
      const script = youtube.chatStreams.shift() ?? holdOpen;
      script(res);
      return;
    }
    const answer =
      url.pathname === "/youtube/v3/liveBroadcasts"
        ? youtube.answers[url.searchParams.get("broadcastStatus") ?? ""]
        : url.pathname === "/youtube/v3/liveChat/messages"
          ? youtube.chatPolls.shift()
          : undefined;
    res.writeHead(answer?.status ?? 404, {
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify(answer?.body ?? { error: { code: 404 } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  youtube.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  youtube.requests = [];
  youtube.answers = {};
  youtube.chatStreams = [];
  youtube.chatPolls = [];
  for (const res of youtube.openStreams) res.destroy();
  youtube.openStreams = [];
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const storeGrant = () =>
  testDb.insert(schema.youtubeAuth).values({
    accessToken: "stored-access-token",
    refreshToken: "stored-refresh-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

const runWithFakeYouTube = <A, E>(
  effect: Effect.Effect<A, E, LinkAuthOperationsService>
) =>
  effect.pipe(
    Effect.provide(testLayer),
    Effect.withConfigProvider(
      ConfigProvider.fromMap(
        new Map([
          ["YOUTUBE_API_URL", youtube.url],
          // A refresh would be a bug here: the stored token is fresh.
          ["GOOGLE_OAUTH_TOKEN_URL", "http://127.0.0.1:9/token"],
        ])
      )
    ),
    Effect.runPromise
  );

const runList = () => runWithFakeYouTube(listBroadcasts);

const broadcastItem = (o: {
  id: string;
  title: string;
  scheduledStartTime?: string;
  enableAutoStart?: boolean;
  enableAutoStop?: boolean;
  liveChatId?: string;
  boundStreamId?: string;
}) => ({
  kind: "youtube#liveBroadcast",
  id: o.id,
  snippet: {
    title: o.title,
    scheduledStartTime: o.scheduledStartTime,
    liveChatId: o.liveChatId,
  },
  contentDetails: {
    enableAutoStart: o.enableAutoStart ?? true,
    enableAutoStop: o.enableAutoStop ?? true,
    boundStreamId: o.boundStreamId,
  },
});

/** Google's answer to a token granted without the scope a call needs. */
const insufficientScope: Answer = {
  status: 403,
  body: {
    error: {
      code: 403,
      message: "Request had insufficient authentication scopes.",
      errors: [
        {
          message: "Insufficient Permission",
          domain: "global",
          reason: "insufficientPermissions",
        },
      ],
      status: "PERMISSION_DENIED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
        },
      ],
    },
  },
};

describe("listBroadcasts", () => {
  it("lists the channel's active and upcoming Broadcasts, active first, then by scheduled start", async () => {
    await storeGrant();
    youtube.answers.active = {
      status: 200,
      body: {
        items: [
          broadcastItem({
            id: "live-now",
            title: "Office hours (live)",
            scheduledStartTime: "2026-10-30T15:00:00Z",
            liveChatId: "chat-live-now",
            boundStreamId: "stream-1",
          }),
        ],
      },
    };
    youtube.answers.upcoming = {
      status: 200,
      body: {
        items: [
          broadcastItem({
            id: "later",
            title: "Q&A",
            scheduledStartTime: "2026-11-02T18:00:00Z",
            enableAutoStart: false,
            liveChatId: "chat-later",
          }),
          broadcastItem({
            id: "sooner",
            title: "Office hours",
            scheduledStartTime: "2026-10-31T18:00:00Z",
            enableAutoStop: false,
            liveChatId: "chat-sooner",
          }),
        ],
      },
    };

    const answer = await runList();

    expect(answer).toEqual({
      status: "listed",
      broadcasts: [
        {
          id: "live-now",
          title: "Office hours (live)",
          scheduledStartTime: "2026-10-30T15:00:00Z",
          enableAutoStart: true,
          enableAutoStop: true,
          liveChatId: "chat-live-now",
          boundStreamId: "stream-1",
        },
        {
          id: "sooner",
          title: "Office hours",
          scheduledStartTime: "2026-10-31T18:00:00Z",
          enableAutoStart: true,
          enableAutoStop: false,
          liveChatId: "chat-sooner",
          boundStreamId: null,
        },
        {
          id: "later",
          title: "Q&A",
          scheduledStartTime: "2026-11-02T18:00:00Z",
          enableAutoStart: false,
          enableAutoStop: true,
          liveChatId: "chat-later",
          boundStreamId: null,
        },
      ],
    });
    expect(
      youtube.requests.every(
        (r) => r.authorization === "Bearer stored-access-token"
      )
    ).toBe(true);
  });

  it("asks for a reconnect when the stored grant lacks live-streaming access", async () => {
    await storeGrant();
    youtube.answers.active = insufficientScope;
    youtube.answers.upcoming = insufficientScope;

    expect(await runList()).toEqual({
      status: "needs-reconnect",
      reason: "missing-live-access",
    });
  });

  it("asks to connect when there is no stored grant, and calls YouTube not at all", async () => {
    expect(await runList()).toEqual({
      status: "needs-reconnect",
      reason: "not-connected",
    });
    expect(youtube.requests).toEqual([]);
  });

  it("fails with YouTube's message on any other error", async () => {
    await storeGrant();
    youtube.answers.active = {
      status: 500,
      body: { error: { code: 500, message: "Backend Error" } },
    };
    youtube.answers.upcoming = { status: 200, body: { items: [] } };

    await expect(runList()).rejects.toThrow(/Backend Error/);
  });
});

/** A stream connection YouTube holds open and says nothing more on. */
function holdOpen(res: http.ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.write("[");
  youtube.openStreams.push(res);
}

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
const startChat = () => {
  const chat = createBroadcastChat({
    youtube: chatYouTube(runWithFakeYouTube),
    reconnectMs: 20,
    maxReconnectMs: 100,
    maxMessages: 500,
  });
  chats.push(chat);
  return chat;
};

afterEach(() => {
  for (const chat of chats) chat.end();
  chats = [];
});

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
  it("streams the picked Broadcast's chat from the pick, and new messages arrive as they're posted", async () => {
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

    chat.pick({ broadcastId: "office-hours", liveChatId: "chat-office-hours" });

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
  });

  it("a Streaming tab that comes back hears what was posted while it was away", async () => {
    await storeGrant();
    youtube.chatStreams.push((res) =>
      sendPages(res, [
        chatPage({
          messages: [fakeViewerMessage(1), fakeViewerMessage(2)],
          nextPageToken: "t1",
        }),
      ])
    );
    const chat = startChat();
    chat.pick({ broadcastId: "office-hours", liveChatId: "chat-office-hours" });
    await vi.waitFor(() => expect(chat.snapshot().messages).toHaveLength(2));

    const heard = listen(chat);

    expect(heard).toEqual([
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

    chat.pick({ broadcastId: "office-hours", liveChatId: "chat-office-hours" });

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

  it("falls back to polling at YouTube's interval only when the stream connection is refused", async () => {
    await storeGrant();
    youtube.chatStreams.push((res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: 404, message: "Not Found" } }));
    });
    youtube.chatPolls.push(
      {
        status: 200,
        body: chatPage({
          messages: [fakeViewerMessage(1)],
          nextPageToken: "p1",
          pollingIntervalMillis: 300,
        }),
      },
      {
        status: 200,
        body: chatPage({
          messages: [fakeViewerMessage(2)],
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

    chat.pick({ broadcastId: "office-hours", liveChatId: "chat-office-hours" });

    await vi.waitFor(() =>
      expect(messagesHeard(heard)).toEqual([shown(1), shown(2)])
    );
    expect(
      chatRequests().map((r) => [r.pathname, r.searchParams.get("pageToken")])
    ).toEqual([
      ["/youtube/v3/liveChat/messages/stream", null],
      ["/youtube/v3/liveChat/messages", null],
      ["/youtube/v3/liveChat/messages", "p1"],
    ]);
    expect(heardAt[1]! - heardAt[0]!).toBeGreaterThanOrEqual(280);
    expect(chat.snapshot().connection).toEqual({ state: "polling" });
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
    chat.pick({ broadcastId: "office-hours", liveChatId: "chat-office-hours" });
    await vi.waitFor(() => expect(chat.snapshot().messages).toHaveLength(1));
    const firstClosed = new Promise((resolve) => first!.on("close", resolve));

    chat.pick({ broadcastId: "qa", liveChatId: "chat-qa" });

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
