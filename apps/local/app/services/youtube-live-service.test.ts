import { describe, it, expect } from "@effect/vitest";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
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
import { listBroadcasts } from "@/services/youtube-live-service";

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

/** A fake YouTube Data API: answers `liveBroadcasts` per `broadcastStatus`. */
let youtube: {
  url: string;
  requests: { path: string; authorization: string | undefined }[];
  answers: Record<string, Answer>;
};
let server: http.Server;

beforeAll(async () => {
  youtube = { url: "", requests: [], answers: {} };
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    youtube.requests.push({
      path: url.pathname + url.search,
      authorization: req.headers.authorization,
    });
    const answer =
      url.pathname === "/youtube/v3/liveBroadcasts"
        ? youtube.answers[url.searchParams.get("broadcastStatus") ?? ""]
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

const runList = () =>
  listBroadcasts.pipe(
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
