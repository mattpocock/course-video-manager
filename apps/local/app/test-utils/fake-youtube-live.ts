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

/**
 * YouTube's live APIs faked at the HTTP boundary, through the YouTube API URL
 * override, with the stored Google grant in the test database. No test
 * reaches Google. Call `useFakeYouTube()` once at a test file's top level:
 * it registers the hooks that start, reset and stop the fake.
 */

export type Answer = { status: number; body: unknown };

/**
 * A fake YouTube Data API: answers `liveBroadcasts` per `broadcastStatus`;
 * hands each `liveChat/messages/stream` connection to the next scripted
 * handler (holding it open when none is left), each `liveChat/messages`
 * poll to the next scripted answer, and each `videos` read to the next
 * scripted answer (a 404 when none is left). Any other call answers the next
 * of its `calls` script, keyed `METHOD /path` (a 404 when none is left).
 */
export const youtube: {
  url: string;
  requests: {
    method: string;
    path: string;
    authorization: string | undefined;
    /** The JSON body sent, or null for none. */
    body: unknown;
  }[];
  answers: Record<string, Answer>;
  /** Scripted answers per call, keyed `METHOD /path` (`POST /youtube/v3/liveBroadcasts`). */
  calls: Record<string, Answer[]>;
  chatStreams: ((res: http.ServerResponse) => void)[];
  chatPolls: Answer[];
  videos: Answer[];
  /** Every stream connection YouTube holds open, newest last. */
  openStreams: http.ServerResponse[];
} = {
  url: "",
  requests: [],
  answers: {},
  calls: {},
  chatStreams: [],
  chatPolls: [],
  videos: [],
  openStreams: [],
};

/** A stream connection YouTube holds open and says nothing more on. */
export function holdOpen(res: http.ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.write("[");
  youtube.openStreams.push(res);
}

/** The scripted answer to a call that isn't a chat stream, if any. */
const answerFor = (method: string, url: URL): Answer | undefined => {
  const scripted = youtube.calls[`${method} ${url.pathname}`]?.shift();
  if (scripted) return scripted;
  switch (url.pathname) {
    case "/youtube/v3/liveBroadcasts":
      return youtube.answers[url.searchParams.get("broadcastStatus") ?? ""];
    case "/youtube/v3/liveChat/messages":
      return youtube.chatPolls.shift();
    case "/youtube/v3/videos":
      return youtube.videos.shift();
  }
};

export const useFakeYouTube = () => {
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

  let server: http.Server;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://fake");
      // Heard as it arrives, so a call CVM abandoned is still counted.
      const request = {
        method: req.method ?? "GET",
        path: url.pathname + url.search,
        authorization: req.headers.authorization,
        body: null as unknown,
      };
      youtube.requests.push(request);
      let text = "";
      req.on("data", (chunk) => (text += String(chunk)));
      req.on("end", () => {
        if (text) request.body = JSON.parse(text) as unknown;
        if (url.pathname === "/youtube/v3/liveChat/messages/stream") {
          const script = youtube.chatStreams.shift() ?? holdOpen;
          script(res);
          return;
        }
        const answer = answerFor(request.method, url);
        res.writeHead(answer?.status ?? 404, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(answer?.body ?? { error: { code: 404 } }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    youtube.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    youtube.requests = [];
    youtube.answers = {};
    youtube.calls = {};
    youtube.chatStreams = [];
    youtube.chatPolls = [];
    youtube.videos = [];
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

  return { storeGrant, runWithFakeYouTube };
};
