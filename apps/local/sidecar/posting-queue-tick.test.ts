import { execFileSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Deferred,
  Effect,
  Fiber,
  Layer,
  Logger,
  LogLevel,
  TestClock,
  TestContext,
} from "effect";
import { NodeContext } from "@effect/platform-node";
import { eq } from "drizzle-orm";
import { JobOperationsService } from "@cvm/core/services/db-job-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { PostingQueueOperationsService } from "@/services/db-posting-queue-operations.server";
import { PostingQueueSidecarService } from "@/services/db-posting-queue-sidecar.server";
import { BufferApiService } from "@/services/buffer-api-service.server";
import { ObjectStoreService } from "@/services/object-store-service.server";
import { SidecarContextTest } from "@/services/sidecar-context";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/test-db";
import { runSidecar, type SidecarTiming } from "./sidecar";
import { youtubeShortsJobKind } from "./kinds/youtube-shorts";
import { bufferJobKind } from "./kinds/buffer";
import type { JobKindRegistry } from "./job-kinds";
import { postingQueueTick, postingQueueTickIn } from "./posting-queue-tick";

// ===========================================================================
// The Posting Queue tick (#2614): at a Posting Slot the Sidecar posts the
// head of the Posting Queue to YouTube direct and to TikTok through Buffer.
//
// The tick reads the time from a TestClock. A REAL Sidecar runs the
// `youtube-shorts` and `buffer` Jobs on PGlite against ONE fake HTTP server
// standing in for Google's token URL, YouTube's upload API, Buffer's API and
// S3, through the existing URL overrides. Nothing leaves this machine.
// ===========================================================================

/** Wednesday 14 October 2026, UK summer time (BST, UTC+1). */
const uk = (hhmm: string, day = "2026-10-14") =>
  new Date(`${day}T${hhmm}:00+01:00`).getTime();

type Seen = { method: string; path: string; query: string; body: string };
let seen: Seen[] = [];
let server: http.Server;
let fakeUrl = "";
let youtubeIds = 0;

const youtubeInits = () =>
  seen.filter(
    (r) => r.method === "POST" && r.path.startsWith("/upload/youtube/v3/videos")
  );
const bufferPosts = () =>
  seen.filter(
    (r) => r.path === "/buffer" && r.body.includes("mutation CreatePost")
  );
const s3Puts = () => seen.filter((r) => r.path.startsWith("/cvm-bucket/"));

const answer = (req: http.IncomingMessage, res: http.ServerResponse) => {
  const url = new URL(req.url ?? "/", "http://fake");
  const json = (status: number, body: unknown, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/token") {
    return json(200, { access_token: "fresh-token", expires_in: 3600 });
  }
  if (url.pathname === "/upload/youtube/v3/videos") {
    return json(200, {}, { Location: `${fakeUrl}/upload-session` });
  }
  if (url.pathname === "/upload-session") {
    youtubeIds += 1;
    return json(200, { id: `yt-${youtubeIds}` });
  }
  if (url.pathname === "/buffer") {
    return json(200, {
      data: { account: { id: "acct" }, createPost: { post: { id: "buf-1" } } },
    });
  }
  if (url.pathname.startsWith("/cvm-bucket/")) {
    res.writeHead(200, { ETag: '"etag"' });
    return res.end();
  }
  json(404, { error: "not faked" });
};

const ENV: Record<string, () => string> = {
  YOUTUBE_API_URL: () => fakeUrl,
  GOOGLE_OAUTH_TOKEN_URL: () => `${fakeUrl}/token`,
  GOOGLE_CLIENT_ID: () => "client-id",
  GOOGLE_CLIENT_SECRET: () => "client-secret",
  BUFFER_API_URL: () => `${fakeUrl}/buffer`,
  BUFFER_API_TOKEN: () => "buffer-token",
  BUFFER_CHANNEL_ID: () => "tiktok-channel",
  S3_ENDPOINT: () => fakeUrl,
  S3_BUCKET: () => "cvm-bucket",
  AWS_REGION: () => "eu-west-2",
  AWS_ACCESS_KEY_ID: () => "fake-key",
  AWS_SECRET_ACCESS_KEY: () => "fake-secret",
  STORAGE_ROOTS: () => root,
};
const previousEnv = Object.fromEntries(
  Object.keys(ENV).map((k) => [k, process.env[k]])
);

let testDb: TestDb;
let root: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let layer: Layer.Layer<any, any, never>;

beforeAll(async () => {
  testDb = (await createTestDb()).testDb;
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        path: new URL(req.url ?? "/", "http://fake").pathname,
        query: new URL(req.url ?? "/", "http://fake").search,
        body,
      });
      answer(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fakeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-posting-queue-"));
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value();

  layer = Layer.mergeAll(
    JobOperationsService.Default,
    VideoPostOperationsService.Default,
    LinkAuthOperationsService.Default,
    PostingQueueOperationsService.Default,
    PostingQueueSidecarService.Default,
    BufferApiService.Default,
    ObjectStoreService.Default
  ).pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never)),
    Layer.merge(NodeContext.layer),
    Layer.merge(SidecarContextTest)
  );
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await truncateAllTables(testDb);
  seen = [];
  // An expired grant: the first post refreshes it at the fake token URL.
  await testDb.insert(schema.youtubeAuth).values({
    accessToken: "stale-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(Date.now() - 60_000),
  });
});

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(layer),
      Logger.withMinimumLogLevel(LogLevel.None)
    ) as Effect.Effect<A, E, never>
  );

/** One tick of the Posting Queue, with the TestClock at `at`. */
const tickAt = (
  at: number,
  tick: Effect.Effect<void, unknown, any> = postingQueueTick
) =>
  run(
    Effect.gen(function* () {
      yield* TestClock.setTime(at);
      yield* tick;
    }).pipe(Effect.provide(TestContext.TestContext))
  );

const TIMING: SidecarTiming = {
  leaseMs: 5_000,
  leaseRenewMs: 1_000,
  jobLeaseMs: 5_000,
  jobHeartbeatMs: 1_000,
  pollMs: 20,
  recoverEveryMs: 1_000,
  lapseWaitMs: 200,
  postCheckTimeoutMs: 1_000,
  postingQueueTickMs: 60_000,
};

// The two posting kinds, run on the test's own layer of services.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const POSTING_KINDS: JobKindRegistry<any> = {
  "youtube-shorts": youtubeShortsJobKind,
  buffer: bufferJobKind,
};

/** A real Sidecar running the two posting kinds until every Job settles. */
const runSidecarUntilSettled = async () => {
  const stop = Effect.runSync(Deferred.make<string>());
  const fiber = Effect.runFork(
    runSidecar({
      identity: {
        holder: `posting-queue-${Math.random()}`,
        pid: process.pid,
        hostname: "test",
        checkout: "/checkouts/posting-queue",
        gitSha: "abc1234",
        socket: path.join(os.tmpdir(), "cvm-posting-queue-test.sock"),
      },
      registry: POSTING_KINDS,
      timing: TIMING,
      stop,
      serve: () => Effect.void,
    }).pipe(Effect.provide(layer), Logger.withMinimumLogLevel(LogLevel.None))
  );
  for (let i = 0; i < 500; i++) {
    const live = await testDb
      .select({ status: schema.jobs.status })
      .from(schema.jobs);
    if (live.every((j) => j.status !== "queued" && j.status !== "running")) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await Effect.runPromise(
    Deferred.succeed(stop, "test over").pipe(Effect.zipRight(Fiber.join(fiber)))
  );
};

/** An exported Short, ready to post. */
const exportedShort = async (title: string, opts = { exported: true }) => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      title,
      originalFootagePath: "f.mp4",
      format: "short",
      description: `All about ${title}`,
    })
    .returning();
  if (opts.exported) {
    fs.mkdirSync(path.join(root, "finished-videos"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "finished-videos", `${video!.id}.mp4`),
      "vertical mp4 bytes"
    );
  }
  return video!.id;
};

const queue = async (videoId: string, queuedAt: number, order: string) => {
  const [entry] = await testDb
    .insert(schema.postingQueueEntries)
    .values({ videoId, queuedAt: new Date(queuedAt), order, state: "queued" })
    .returning();
  return entry!.id;
};

const stateOf = async (entryId: string) => {
  const [entry] = await testDb
    .select()
    .from(schema.postingQueueEntries)
    .where(eq(schema.postingQueueEntries.id, entryId));
  return entry!;
};

const jobKinds = async () =>
  (await testDb.select({ kind: schema.jobs.kind }).from(schema.jobs))
    .map((j) => j.kind)
    .sort();

describe("the Posting Queue tick", () => {
  it("at 13:00 UK on a weekday posts the one queued Short once to YouTube (public, no notification) and once to Buffer (shareNow), and the entry ends Posted", async () => {
    const videoId = await exportedShort("Ship it");
    const entryId = await queue(videoId, uk("08:00"), "a0");

    await tickAt(uk("12:59"));
    expect((await stateOf(entryId)).state).toBe("queued");
    expect(await jobKinds()).toEqual([]);

    await tickAt(uk("13:00"));
    const claimed = await stateOf(entryId);
    expect(claimed.state).toBe("posting");
    expect(claimed.claimedSlot?.getTime()).toBe(uk("13:00"));
    expect(await jobKinds()).toEqual(["buffer", "youtube-shorts"]);

    await runSidecarUntilSettled();
    await tickAt(uk("13:02"));

    const posted = await stateOf(entryId);
    expect(posted.state).toBe("posted");
    expect(posted.endedAt).not.toBeNull();

    expect(youtubeInits()).toHaveLength(1);
    const init = youtubeInits()[0]!;
    expect(new URLSearchParams(init.query).get("notifySubscribers")).toBe(
      "false"
    );
    expect(JSON.parse(init.body)).toMatchObject({
      snippet: { title: "Ship it", description: "All about Ship it" },
      status: { privacyStatus: "public" },
    });
    expect(
      seen.find((r) => r.path === "/token"),
      "the stored grant was refreshed at the fake token URL"
    ).toBeDefined();

    expect(s3Puts().map((r) => r.path)).toEqual([
      `/cvm-bucket/cvm/buffer-posts/${videoId}.mp4`,
    ]);
    expect(bufferPosts()).toHaveLength(1);
    const input = JSON.parse(bufferPosts()[0]!.body).variables.input;
    expect(input).toMatchObject({
      channelId: "tiktok-channel",
      text: "Ship it",
      assets: [
        {
          video: {
            url: `${fakeUrl}/cvm-bucket/cvm/buffer-posts/${videoId}.mp4`,
          },
        },
      ],
    });
    // REGRESSION: a Short's Buffer post must publish at once, never sit in
    // Buffer's own queue (its free plan holds 10, and S3 deletes the file
    // after a day).
    expect(input.mode).toBe("shareNow");
  });

  it("ticking again, a crash after the claim, and restarting the Sidecar never post either channel twice", async () => {
    const videoId = await exportedShort("Only once");
    const entryId = await queue(videoId, uk("08:00"), "a0");

    // The claim commits, then the Sidecar is gone before it runs a Job.
    await tickAt(uk("13:00"));
    await tickAt(uk("13:02"));
    await tickAt(uk("13:04"));
    expect(await jobKinds()).toEqual(["buffer", "youtube-shorts"]);

    // It comes back: the claimed Jobs run once.
    await runSidecarUntilSettled();
    await tickAt(uk("13:06"));
    expect((await stateOf(entryId)).state).toBe("posted");

    // Restarted again, and ticked again, later the same day.
    await runSidecarUntilSettled();
    await tickAt(uk("13:08"));
    await tickAt(uk("17:00"));

    expect(await jobKinds()).toEqual(["buffer", "youtube-shorts"]);
    expect(youtubeInits()).toHaveLength(1);
    expect(bufferPosts()).toHaveLength(1);
  });

  it("two slots due at once (CVM was off) give one claim per tick, and the second only once the first has settled", async () => {
    // Both were in the queue all Wednesday and nothing was posted, so
    // Thursday catches up: 09:00 and 18:00. CVM comes back at 19:00.
    const first = await queue(await exportedShort("First"), uk("08:00"), "a0");
    const second = await queue(
      await exportedShort("Second"),
      uk("08:01"),
      "a1"
    );
    const thursday = (hhmm: string) => uk(hhmm, "2026-10-15");

    await tickAt(thursday("19:00"));
    await tickAt(thursday("19:02"));
    expect((await stateOf(first)).claimedSlot?.getTime()).toBe(
      thursday("09:00")
    );
    expect((await stateOf(second)).state).toBe("queued");
    expect(await jobKinds()).toHaveLength(2);

    await runSidecarUntilSettled();
    await tickAt(thursday("19:04"));
    expect((await stateOf(first)).state).toBe("posted");
    expect((await stateOf(second)).claimedSlot?.getTime()).toBe(
      thursday("18:00")
    );

    await runSidecarUntilSettled();
    await tickAt(thursday("19:06"));
    expect((await stateOf(second)).state).toBe("posted");
    expect(youtubeInits()).toHaveLength(2);
    expect(bufferPosts()).toHaveLength(2);
  });

  it("a Short with no vertical export does not claim: it waits, and `cvm short queue` says why", async () => {
    const videoId = await exportedShort("Not rendered", { exported: false });
    const entryId = await queue(videoId, uk("08:00"), "a0");

    await tickAt(uk("13:00"));

    expect((await stateOf(entryId)).state).toBe("queued");
    expect(await jobKinds()).toEqual([]);
    const listing = await run(
      Effect.flatMap(PostingQueueOperationsService, (svc) =>
        svc.listPostingQueue(uk("13:01"))
      )
    );
    expect(listing.entries[0]).toMatchObject({
      entryId,
      state: "queued",
      lastFailureReason: expect.stringContaining(
        `has not been rendered. Render it with 'cvm short render ${videoId}'`
      ),
    });
  });

  it("only the main checkout's Sidecar claims: a linked worktree and a scratch clone never do", async () => {
    const entryId = await queue(
      await exportedShort("Main only"),
      uk("08:00"),
      "a0"
    );
    const repos = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-checkouts-"));
    const main = path.join(repos, "main");
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", args, { cwd, stdio: "ignore" });
    try {
      fs.mkdirSync(main);
      git(main, "init", "-q");
      git(
        main,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "init"
      );
      git(main, "worktree", "add", "-q", path.join(repos, "worktree"));
      const noScratch = { scratchRoots: [] };

      await tickAt(
        uk("13:00"),
        postingQueueTickIn(path.join(repos, "worktree"), noScratch)
      );
      // A clone in the temp directory is an agent's (verify-cvm's) scratch.
      await tickAt(uk("13:00"), postingQueueTickIn(main));
      expect((await stateOf(entryId)).state).toBe("queued");
      expect(await jobKinds()).toEqual([]);

      await tickAt(uk("13:00"), postingQueueTickIn(main, noScratch));
      expect((await stateOf(entryId)).state).toBe("posting");
    } finally {
      fs.rmSync(repos, { recursive: true, force: true });
    }
  });
});
