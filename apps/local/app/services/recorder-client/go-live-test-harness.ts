import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, expect, vi } from "vitest";
import { ConfigProvider, Effect, Either, Layer } from "effect";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { DrizzleService } from "@/services/drizzle-service.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";
import type { StreamStatus } from "recorder-service/stream-protocol";
import { CALIBRATION } from "recorder-service/test-utils/service-harness";
import {
  fakeWindows,
  writesFile,
} from "recorder-service/test-utils/fake-windows";
import { STREAM_TAG } from "recorder-service/stream-args";
import type { Launch } from "recorder-service/launcher";
import {
  clipService,
  setupClipServiceTests,
  testDb,
} from "../clip-service-test-setup";
import {
  connectClient,
  freshCalibration,
  startService,
  tmp,
} from "./recorder-client-test-harness";
import { goLive } from "./go-live.server";

/**
 * The Go Live end-to-end harness (ADR 0054), without hardware: the real
 * recorder service on a scripted Windows, whose launcher also stands in for
 * the Live Stream's ffmpeg.exe; the app server's recorder client and Go Live;
 * the test database; and YouTube faked at the HTTP boundary.
 */

/** A fake Stream Key: it must turn up on the stream's command line and nowhere else. */
export const KEY = "fake-key-q7w2-9xk4-mm31";

/** While the test's AV Calibration (a day old by the service's clock) is fresh. */
export const NOW = new Date(CALIBRATION.createdAtMs + 60 * 60 * 1000);

/** The YouTube stream whose ingest name is the Stream Key. */
export const KEYS_STREAM = "stream-with-the-key";

/** A YouTube stream, as `liveStreams.list?part=cdn` answers it. */
export const youtubeStream = (id: string, streamName: string) => ({
  id,
  cdn: { ingestionInfo: { streamName } },
});

/** The fake YouTube: what it answers, and each call CVM made to it. */
export const youtube: {
  url: string;
  broadcasts: unknown[];
  streams: unknown[];
  /** Each call CVM made, as `METHOD /path?query`. */
  calls: string[];
} = { url: "", broadcasts: [], streams: [], calls: [] };

/**
 * A Go Live test file's setup: the clip service's test database, and YouTube
 * faked at the HTTP boundary on a loopback port.
 */
export const setupGoLiveTests = () => {
  setupClipServiceTests();
  let server: http.Server;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://fake");
      youtube.calls.push(`${req.method} ${url.pathname}${url.search}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      if (url.pathname === "/youtube/v3/liveStreams") {
        res.end(JSON.stringify({ items: youtube.streams }));
        return;
      }
      if (url.pathname === "/youtube/v3/liveBroadcasts/bind") {
        res.end(JSON.stringify({ id: url.searchParams.get("id") }));
        return;
      }
      const listed =
        url.pathname === "/youtube/v3/liveBroadcasts" &&
        url.searchParams.get("broadcastStatus") === "upcoming";
      res.end(JSON.stringify({ items: listed ? youtube.broadcasts : [] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    youtube.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
};

export const broadcast = (
  id: string,
  o: { enableAutoStart?: boolean; boundStreamId?: string } = {}
) => ({
  id,
  snippet: { title: id, scheduledStartTime: "2026-10-31T18:00:00Z" },
  contentDetails: {
    enableAutoStart: o.enableAutoStart ?? true,
    enableAutoStop: true,
    // Bound to the Stream Key's stream unless a test says otherwise.
    boundStreamId: "boundStreamId" in o ? o.boundStreamId : KEYS_STREAM,
  },
});

/** The bind calls CVM made to YouTube. */
export const binds = () =>
  youtube.calls.filter((c) => c.includes("/liveBroadcasts/bind"));

/** A `.env` with the Stream Key in it, or without. */
export const envFile = (withKey: boolean) => {
  const file = path.join(tmp(), ".env");
  fs.writeFileSync(
    file,
    `DATABASE_URL=postgres://nowhere\n${withKey ? `YOUTUBE_STREAM_KEY=${KEY}\n` : ""}`
  );
  return file;
};

const run = <A, E>(
  effect: Effect.Effect<A, E, LinkAuthOperationsService | DrizzleService>
) =>
  Effect.runPromise(
    Effect.either(effect).pipe(
      Effect.provide(
        LinkAuthOperationsService.Default.pipe(
          Layer.provideMerge(Layer.succeed(DrizzleService, testDb as never))
        )
      ),
      Effect.withConfigProvider(
        ConfigProvider.fromMap(
          new Map([
            ["YOUTUBE_API_URL", youtube.url],
            ["GOOGLE_OAUTH_TOKEN_URL", "http://127.0.0.1:9/token"],
          ])
        )
      )
    )
  );

export const isFfmpeg = (l: Launch): l is Extract<Launch, { tool: "ffmpeg" }> =>
  l.tool === "ffmpeg";
export const isStream = (l: Launch) =>
  isFfmpeg(l) && l.args.includes(`comment=${STREAM_TAG}`);
export const isStreamedWriter = (l: Launch) =>
  isFfmpeg(l) &&
  writesFile(l.args, "camera.mkv") &&
  l.args.some((a) => a.includes("[streamcam]"));
export const isScreenRecorder = (l: Launch) =>
  isFfmpeg(l) && writesFile(l.args, "screen.mkv");

/** The loopback ports in `args` that match `pattern`'s one group. */
export const ports = (args: readonly string[], pattern: RegExp) =>
  [...args.join(" ").matchAll(pattern)].map((m) => Number(m[1]));

/** The recorder open on a fresh Landscape Video, its camera live, ready to Go Live. */
export const ready = async (
  o: {
    windows?: ReturnType<typeof fakeWindows>;
    streamListenBoundMs?: number;
    streamStallMs?: number;
    format?: "landscape" | "short";
  } = {}
) => {
  const windows = o.windows ?? fakeWindows();
  const stateDir = tmp();
  const { port } = await startService(stateDir, windows, {
    streamListenBoundMs: o.streamListenBoundMs,
    streamStallMs: o.streamStallMs,
  });
  const client = connectClient(port);
  await freshCalibration();
  await testDb.insert(schema.youtubeAuth).values({
    accessToken: "stored-access-token",
    refreshToken: "stored-refresh-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  youtube.broadcasts = [broadcast("office-hours")];
  youtube.streams = [
    youtubeStream("another-stream", "some-other-key"),
    youtubeStream(KEYS_STREAM, KEY),
  ];
  youtube.calls = [];
  const video = await clipService.createVideo("Office hours");
  if (o.format === "short")
    await testDb
      .update(schema.videos)
      .set({ format: "short" })
      .where(eq(schema.videos.id, video.id));
  const heard: CvmRecorderMessage[] = [];
  client.subscribe(video.id, (m) => heard.push(m), o.format);
  await vi.waitFor(() =>
    expect(heard).toContainEqual({ type: "camera-went-live" })
  );
  // As the editor does: the next take's ordinary writer is armed.
  client.setSilenceLength(video.id, "short");
  if (o.format !== "short")
    await vi.waitFor(() => expect(windows.armedWriters()).toHaveLength(1));
  const folder = tmp();
  const goLiveWith = (more: Partial<Parameters<typeof goLive>[0]> = {}) =>
    run(
      goLive({
        db: testDb as never,
        client,
        videoId: video.id,
        broadcastId: "office-hours",
        silenceLength: "short",
        folder,
        envPath: envFile(true),
        now: NOW,
        ...more,
      })
    );
  const streamStatuses = () =>
    heard.flatMap((m): StreamStatus[] =>
      m.type === "stream-changed" ? [m.stream] : []
    );
  return {
    windows,
    client,
    video,
    heard,
    folder,
    stateDir,
    port,
    goLive: goLiveWith,
    streamStatuses,
  };
};

/** Every reason Go Live was refused for; fails the test if it was not. */
export const reasonsOf = (
  answer: Either.Either<unknown, { _tag: string; message: string }>
): readonly string[] => {
  if (Either.isRight(answer)) throw new Error("Go Live was let through");
  if (answer.left._tag !== "GoLiveRefusedError")
    throw new Error(`Refused another way: ${answer.left.message}`);
  return (answer.left as unknown as { reasons: readonly string[] }).reasons;
};

export const ended = (statuses: StreamStatus[]) =>
  statuses.flatMap((s) => (s.kind === "ended" ? [s.reason] : []));
