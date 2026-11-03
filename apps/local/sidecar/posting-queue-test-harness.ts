import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach } from "vitest";
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
import { renderVerticalJobKind } from "./kinds/render-vertical";
import { postingQueueTick } from "./posting-queue-tick";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import {
  RenderVerticalError,
  RenderVerticalVideoService,
} from "@/services/render-vertical-video-service";
import {
  SHORT_EXPORT_HASH_SUFFIX,
  shortExportHashOf,
} from "@/services/short-export-hash";
import { storageRootsConfig } from "@/services/storage-roots";

// ===========================================================================
// The harness of the Posting Queue tick's tests (#2614, #2615): at a Posting Slot the Sidecar posts the
// head of the Posting Queue to YouTube direct and to TikTok through Buffer.
//
// The tick reads the time from a TestClock. A REAL Sidecar runs the
// `youtube-shorts` and `buffer` Jobs on PGlite against ONE fake HTTP server
// standing in for Google's token URL, YouTube's upload API, Buffer's API and
// S3, through the existing URL overrides. Nothing leaves this machine. The
// vertical render is faked: it writes the file and its Short Export Hash, or
// fails as `renderFails` says.
// ===========================================================================

/** Wednesday 14 October 2026, UK summer time (BST, UTC+1). */
export const uk = (hhmm: string, day = "2026-10-14") =>
  new Date(`${day}T${hhmm}:00+01:00`).getTime();

type Seen = { method: string; path: string; query: string; body: string };
export let seen: Seen[] = [];
let server: http.Server;
export let fakeUrl = "";
let youtubeIds = 0;

/**
 * How the fakes misbehave. `bufferRefuses`: Buffer answers `createPost`
 * with a `MutationError`, so it makes no post. `youtubeUploadFails`:
 * this many YouTube uploads answer 500 before one succeeds. `youtubeUploads`:
 * what the channel's uploads playlist lists, which the read-only post check
 * reads.
 */
export const fakes = {
  bufferRefuses: false,
  youtubeUploadFails: 0,
  youtubeUploads: [] as { title: string; videoId: string }[],
};

export const youtubeInits = () =>
  seen.filter(
    (r) => r.method === "POST" && r.path.startsWith("/upload/youtube/v3/videos")
  );
export const bufferPosts = () =>
  seen.filter(
    (r) => r.path === "/buffer" && r.body.includes("mutation CreatePost")
  );
export const s3Puts = () =>
  seen.filter((r) => r.path.startsWith("/cvm-bucket/"));

const answer = (
  req: http.IncomingMessage,
  body: string,
  res: http.ServerResponse
) => {
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
    if (fakes.youtubeUploadFails > 0) {
      fakes.youtubeUploadFails -= 1;
      return json(500, { error: "backend error" });
    }
    youtubeIds += 1;
    return json(200, { id: `yt-${youtubeIds}` });
  }
  if (url.pathname === "/youtube/v3/channels") {
    return json(200, {
      items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1" } } }],
    });
  }
  if (url.pathname === "/youtube/v3/playlistItems") {
    return json(200, {
      items: fakes.youtubeUploads.map((u) => ({
        snippet: {
          title: u.title,
          publishedAt: new Date().toISOString(),
          resourceId: { videoId: u.videoId },
        },
      })),
    });
  }
  if (url.pathname === "/buffer") {
    if (fakes.bufferRefuses && body.includes("mutation CreatePost")) {
      return json(200, { data: { createPost: { message: "TikTok is busy" } } });
    }
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

export let testDb: TestDb;
export let root: string;
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
      answer(req, body, res);
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
    ObjectStoreService.Default,
    VideoOperationsService.Default,
    ClipOperationsService.Default
  ).pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never)),
    (services) =>
      Layer.merge(services, fakeRender.pipe(Layer.provide(services))),
    Layer.merge(NodeContext.layer),
    Layer.merge(SidecarContextTest)
  );
});

/** How many times the fake vertical render ran. */
export let renders = 0;
/** Set to make every vertical render fail, as the overlay renderer can. */
export const render = { fails: false };

/**
 * Write a Short's vertical export, as the render does: its file and, beside
 * it, its Short Export Hash as its Clips are now.
 */
const writeVerticalExport = (videoId: string) =>
  Effect.gen(function* () {
    const roots = yield* storageRootsConfig;
    const video = yield* (yield* VideoOperationsService).getVideoWithClipsById(
      videoId
    );
    const hash = yield* shortExportHashOf(video, roots);
    const file = path.join(root, "finished-videos", `${videoId}.mp4`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "vertical mp4 bytes");
    fs.writeFileSync(`${file}${SHORT_EXPORT_HASH_SUFFIX}`, hash!);
    return file;
  });

const fakeRender = Layer.effect(
  RenderVerticalVideoService,
  Effect.gen(function* () {
    const context = yield* Effect.context<
      VideoOperationsService | ClipOperationsService
    >();
    return RenderVerticalVideoService.make({
      renderVerticalVideo: (opts) =>
        Effect.gen(function* () {
          renders += 1;
          if (render.fails) {
            return yield* new RenderVerticalError({
              cause: null,
              message: "Overlay renderer exited with code 1: boom",
            });
          }
          return yield* writeVerticalExport(opts.videoId).pipe(
            Effect.orDie,
            Effect.provide(context)
          );
        }),
    });
  })
);

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
  renders = 0;
  render.fails = false;
  fakes.bufferRefuses = false;
  fakes.youtubeUploadFails = 0;
  fakes.youtubeUploads = [];
  // An expired grant: the first post refreshes it at the fake token URL.
  await testDb.insert(schema.youtubeAuth).values({
    accessToken: "stale-token",
    refreshToken: "refresh-token",
    expiresAt: new Date(Date.now() - 60_000),
  });
});

export const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(layer),
      Logger.withMinimumLogLevel(LogLevel.None)
    ) as Effect.Effect<A, E, never>
  );

/** One tick of the Posting Queue, with the TestClock at `at`. */
export const tickAt = (
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

// The two posting kinds and the vertical render, run on the test's own
// layer of services.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const POSTING_KINDS: JobKindRegistry<any> = {
  "youtube-shorts": youtubeShortsJobKind,
  buffer: bufferJobKind,
  "render-vertical": renderVerticalJobKind,
};

/** A real Sidecar running those kinds until every Job settles. */
export const runSidecarUntilSettled = async () => {
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

/**
 * A Short of one Clip. `fresh`: rendered as it is now. `legacy`: rendered
 * before the Short Export Hash, so no hash file beside it. `none`: never
 * rendered.
 */
export const exportedShort = async (
  title: string,
  exported: "fresh" | "legacy" | "none" = "fresh"
) => {
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      title,
      originalFootagePath: "f.mp4",
      format: "short",
      description: `All about ${title}`,
    })
    .returning();
  await testDb.insert(schema.clips).values({
    videoId: video!.id,
    videoFilename: "raw-footage/a.mp4",
    sourceStartTime: 0,
    sourceEndTime: 10,
    order: "a0",
    text: `Hello from ${title}`,
  });
  if (exported !== "none") {
    const file = await run(writeVerticalExport(video!.id));
    if (exported === "legacy") fs.rmSync(`${file}${SHORT_EXPORT_HASH_SUFFIX}`);
  }
  return video!.id;
};

export const queue = async (
  videoId: string,
  queuedAt: number,
  order: string
) => {
  const [entry] = await testDb
    .insert(schema.postingQueueEntries)
    .values({ videoId, queuedAt: new Date(queuedAt), order, state: "queued" })
    .returning();
  return entry!.id;
};

export const stateOf = async (entryId: string) => {
  const [entry] = await testDb
    .select()
    .from(schema.postingQueueEntries)
    .where(eq(schema.postingQueueEntries.id, entryId));
  return entry!;
};

export const jobKinds = async () =>
  (await testDb.select({ kind: schema.jobs.kind }).from(schema.jobs))
    .map((j) => j.kind)
    .sort();
