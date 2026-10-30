import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ConfigProvider, Effect, Either, Layer, Redacted } from "effect";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { DrizzleService } from "@/services/drizzle-service.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { STREAM_KEY_MISSING } from "@/services/stream-key.server";
import type { CvmRecorderMessage } from "@/features/video-editor/cvm-recorder-wire";
import { broadcastRefusal } from "@/features/streaming/broadcast";
import {
  GO_LIVE_REFUSALS,
  type StreamStatus,
} from "recorder-service/stream-protocol";
import {
  CALIBRATION,
  connect,
} from "recorder-service/test-utils/service-harness";
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
  readSession,
  startService,
  tmp,
} from "./recorder-client-test-harness";
import { goLive, NO_BROADCAST, NO_MATCHING_STREAM } from "./go-live.server";

/**
 * Go Live and End Stream end to end (ADR 0054), without hardware: the real
 * recorder service on a scripted Windows, whose launcher also stands in for
 * the Live Stream's ffmpeg.exe; the app server's recorder client and Go Live;
 * the test database; and YouTube faked at the HTTP boundary.
 */

setupClipServiceTests();

/** A fake Stream Key: it must turn up on the stream's command line and nowhere else. */
const KEY = "fake-key-q7w2-9xk4-mm31";

/** While the test's AV Calibration (a day old by the service's clock) is fresh. */
const NOW = new Date(CALIBRATION.createdAtMs + 60 * 60 * 1000);

/** The YouTube stream whose ingest name is the Stream Key. */
const KEYS_STREAM = "stream-with-the-key";

/** A YouTube stream, as `liveStreams.list?part=cdn` answers it. */
const youtubeStream = (id: string, streamName: string) => ({
  id,
  cdn: { ingestionInfo: { streamName } },
});

let youtube: {
  url: string;
  broadcasts: unknown[];
  streams: unknown[];
  /** Each call CVM made, as `METHOD /path?query`. */
  calls: string[];
};
let server: http.Server;
beforeAll(async () => {
  youtube = { url: "", broadcasts: [], streams: [], calls: [] };
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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  youtube.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const broadcast = (
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
const binds = () =>
  youtube.calls.filter((c) => c.includes("/liveBroadcasts/bind"));

/** A `.env` with the Stream Key in it, or without. */
const envFile = (withKey: boolean) => {
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

const isFfmpeg = (l: Launch): l is Extract<Launch, { tool: "ffmpeg" }> =>
  l.tool === "ffmpeg";
const isStream = (l: Launch) =>
  isFfmpeg(l) && l.args.includes(`comment=${STREAM_TAG}`);
const isStreamedWriter = (l: Launch) =>
  isFfmpeg(l) &&
  writesFile(l.args, "camera.mkv") &&
  l.args.some((a) => a.includes("[streamcam]"));
const isScreenRecorder = (l: Launch) =>
  isFfmpeg(l) && writesFile(l.args, "screen.mkv");

/** The loopback ports in `args` that match `pattern`'s one group. */
const ports = (args: readonly string[], pattern: RegExp) =>
  [...args.join(" ").matchAll(pattern)].map((m) => Number(m[1]));

/** The recorder open on a fresh Landscape Video, its camera live, ready to Go Live. */
const ready = async (
  o: {
    windows?: ReturnType<typeof fakeWindows>;
    streamListenBoundMs?: number;
    format?: "landscape" | "short";
  } = {}
) => {
  const windows = o.windows ?? fakeWindows();
  const stateDir = tmp();
  const { port } = await startService(stateDir, windows, {
    streamListenBoundMs: o.streamListenBoundMs,
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
const reasonsOf = (
  answer: Either.Either<unknown, { _tag: string; message: string }>
): readonly string[] => {
  if (Either.isRight(answer)) throw new Error("Go Live was let through");
  if (answer.left._tag !== "GoLiveRefusedError")
    throw new Error(`Refused another way: ${answer.left.message}`);
  return (answer.left as unknown as { reasons: readonly string[] }).reasons;
};

const ended = (statuses: StreamStatus[]) =>
  statuses.flatMap((s) => (s.kind === "ended" ? [s.reason] : []));

describe("Go Live and End Stream", () => {
  it("arms a streamed writer, starts the stream listening for its feeds, then records; End Stream stops both", async () => {
    const r = await ready();

    expect(Either.isRight(await r.goLive())).toBe(true);

    const launched = r.windows.launched;
    const writer = launched.findIndex(isStreamedWriter);
    const stream = launched.findIndex(isStream);
    // The screen recorder is launched at Record, with T0.
    const record = launched.findIndex(isScreenRecorder);
    // The ordinary armed writer made way for a streamed one.
    expect(
      launched.findIndex((l) => isFfmpeg(l) && writesFile(l.args, "camera.mkv"))
    ).toBeLessThan(writer);
    expect(writer).toBeLessThan(stream);
    expect(stream).toBeLessThan(record);

    // Each feed goes where the stream listens: screen first, then camera.
    const streamArgs = (launched[stream] as Extract<Launch, { tool: "ffmpeg" }>)
      .args;
    const [screenPort, cameraPort] = ports(
      streamArgs,
      /tcp:\/\/127\.0\.0\.1:(\d+)\?listen=1/g
    );
    const writerArgs = (launched[writer] as Extract<Launch, { tool: "ffmpeg" }>)
      .args;
    const screenArgs = (launched[record] as Extract<Launch, { tool: "ffmpeg" }>)
      .args;
    expect(ports(writerArgs, /\]tcp:\/\/127\.0\.0\.1:(\d+)\?timeout/g)).toEqual(
      [cameraPort]
    );
    expect(ports(screenArgs, /\]tcp:\/\/127\.0\.0\.1:(\d+)\?timeout/g)).toEqual(
      [screenPort]
    );
    expect(screenArgs).toContain("+global_header");
    // The key goes after YouTube's ingest, on the stream's command line.
    expect(streamArgs.join(" ")).toContain(
      `rtmps://a.rtmps.youtube.com:443/live2/${KEY}|`
    );

    await vi.waitFor(() =>
      expect(r.heard.map((m) => m.type)).toContain("recording-started")
    );
    expect(r.streamStatuses().map((s) => s.kind)).toEqual(
      expect.arrayContaining(["starting", "connecting"])
    );
    // Frames go out: it is live.
    const streamProcess = r.windows.streams[0]!;
    streamProcess.stdout("frame=60\nprogress=continue\n");
    await vi.waitFor(() =>
      expect(r.streamStatuses().at(-1)).toEqual({ kind: "live" })
    );

    await r.client.endStream(r.video.id);

    await vi.waitFor(() =>
      expect(r.heard.map((m) => m.type)).toContain("recording-stopped")
    );
    expect(streamProcess.written).toContain("q");
    expect(ended(r.streamStatuses())).toEqual(["End Stream."]);
    // Ingested like any other Recording Session.
    await r.client.settled();
    expect(await readSession()).toMatchObject({ videoId: r.video.id });
    // The next take's writer is an ordinary one again.
    await vi.waitFor(() => {
      const armed = r.windows.armedWriters();
      expect(armed).toHaveLength(1);
      expect(isStreamedWriter(armed[0]!.launch)).toBe(false);
    });
  });

  it("leaves a Recording Session that is not streamed exactly as it was: no tee, no feed, no stream", async () => {
    const r = await ready();

    await r.client.startRecording(r.video.id, {
      silenceLength: "short",
      folder: r.folder,
    });

    const screen = r.windows.recorder("screen").launch;
    const writer = r.windows.recorder("camera").launch;
    if (!isFfmpeg(screen) || !isFfmpeg(writer)) throw new Error("not ffmpeg");
    expect(screen.args.at(-1)).toBe("screen.mkv");
    expect(screen.args).not.toContain("+global_header");
    expect(screen.args).not.toContain("tee");
    expect(writer.args.join(" ")).not.toContain("streamcam");
    expect(writer.args).not.toContain("-use_fifo");
    expect(r.windows.launched.some(isStream)).toBe(false);
  });

  it("refuses with every reason that applies: no Broadcast, no Stream Key, no fresh AV Calibration", async () => {
    const r = await ready();

    const answer = await r.goLive({
      broadcastId: null,
      envPath: envFile(false),
      now: new Date(CALIBRATION.createdAtMs + 30 * 24 * 60 * 60 * 1000),
    });

    const reasons = reasonsOf(answer);
    expect(reasons).toHaveLength(3);
    expect(reasons).toEqual(
      expect.arrayContaining([NO_BROADCAST, STREAM_KEY_MISSING])
    );
    // Nothing started.
    expect(r.windows.launched.some(isStream)).toBe(false);
    expect(r.heard.map((m) => m.type)).not.toContain("recording-started");
  });

  it("refuses a Broadcast YouTube won't auto-start, and a recorder already recording, together", async () => {
    const r = await ready();
    youtube.broadcasts = [
      broadcast("office-hours", { enableAutoStart: false }),
    ];
    await r.client.startRecording(r.video.id, {
      silenceLength: "short",
      folder: r.folder,
    });

    const answer = await r.goLive();

    expect(reasonsOf(answer)).toEqual([
      broadcastRefusal({
        id: "office-hours",
        title: "office-hours",
        scheduledStartTime: null,
        enableAutoStart: false,
        enableAutoStop: true,
        liveChatId: null,
        boundStreamId: null,
      }),
      GO_LIVE_REFUSALS.recording,
    ]);
    expect(r.windows.launched.some(isStream)).toBe(false);
  });

  it("refuses a Short", async () => {
    const r = await ready({
      format: "short",
      windows: fakeWindows({ spacedesk: { width: 1080, height: 1080 } }),
    });

    const answer = await r.goLive();

    expect(reasonsOf(answer)).toEqual([GO_LIVE_REFUSALS.short]);
  });

  it("refuses while the screen preview has fallen back to the CPU encoder", async () => {
    const r = await ready({ windows: fakeWindows({ nvencBusy: true }) });

    const answer = await r.goLive();

    if (Either.isRight(answer)) throw new Error("Go Live was let through");
    expect(answer.left.message).toBe(GO_LIVE_REFUSALS.cpuPreview);
    expect(r.windows.launched.some(isStream)).toBe(false);
    expect(r.heard.map((m) => m.type)).not.toContain("recording-started");
  });
});

describe("binding the picked Broadcast to the Stream Key's YouTube stream", () => {
  it.each([
    ["unbound", undefined],
    ["bound to another stream", "another-stream"],
  ])(
    "binds a Broadcast that is %s to the stream whose ingest name is the Stream Key, then goes live",
    async (_, boundStreamId) => {
      const r = await ready();
      youtube.broadcasts = [broadcast("office-hours", { boundStreamId })];

      expect(Either.isRight(await r.goLive())).toBe(true);

      expect(binds()).toEqual([
        expect.stringMatching(
          new RegExp(
            `^POST /youtube/v3/liveBroadcasts/bind\\?.*id=office-hours.*streamId=${KEYS_STREAM}`
          )
        ),
      ]);
      // YouTube's auto-start and auto-stop drive the Broadcast, never CVM.
      expect(youtube.calls.join("\n")).not.toContain("transition");
      await vi.waitFor(() =>
        expect(r.heard.map((m) => m.type)).toContain("recording-started")
      );
    }
  );

  it("leaves a Broadcast already bound to the Stream Key's stream alone", async () => {
    const r = await ready();

    expect(Either.isRight(await r.goLive())).toBe(true);

    expect(binds()).toEqual([]);
  });

  it("refuses, without showing the key, when no YouTube stream's ingest name is the Stream Key", async () => {
    const r = await ready();
    youtube.broadcasts = [
      broadcast("office-hours", { boundStreamId: undefined }),
    ];
    youtube.streams = [youtubeStream("another-stream", "some-other-key")];

    const answer = await r.goLive();

    expect(reasonsOf(answer)).toEqual([NO_MATCHING_STREAM]);
    expect(NO_MATCHING_STREAM).not.toContain(KEY);
    expect(binds()).toEqual([]);
    expect(r.windows.launched.some(isStream)).toBe(false);
  });
});

describe("raw footage first: a stream failure never stops or delays the take", () => {
  it("records anyway once the fixed bound passes, when the stream process never comes up", async () => {
    const r = await ready({
      windows: fakeWindows({ stream: "never" }),
      streamListenBoundMs: 100,
    });

    expect(Either.isRight(await r.goLive())).toBe(true);

    await vi.waitFor(() =>
      expect(r.heard.map((m) => m.type)).toContain("recording-started")
    );
    expect(r.streamStatuses().map((s) => s.kind)).not.toContain("connecting");
    r.windows.streams[0]!.exit(null);
  });

  it("keeps recording when the stream process dies mid-take, and End Stream still stops the take", async () => {
    const r = await ready();
    await r.goLive();
    await vi.waitFor(() =>
      expect(r.heard.map((m) => m.type)).toContain("recording-started")
    );
    const screen = r.windows.recorder("screen");
    const writer = r.windows.recorder("camera");

    // The stream process is killed (its own handle): YouTube gone, a crash.
    r.windows.streams[0]!.exit(1);

    await vi.waitFor(() =>
      expect(ended(r.streamStatuses())).toEqual([
        expect.stringContaining("The stream process quit"),
      ])
    );
    expect(r.heard.map((m) => m.type)).not.toContain("recording-stopped");
    // Nothing asked the take's processes to stop.
    expect(screen.written).toBe("");
    expect(writer.written).not.toContain("q");
    expect(screen.running && writer.running).toBe(true);

    await r.client.endStream(r.video.id);

    await vi.waitFor(() =>
      expect(r.heard).toContainEqual(
        expect.objectContaining({ type: "recording-stopped", errors: [] })
      )
    );
  });

  it("ends the Live Stream, saying why, when the Recording Session ends on its own", async () => {
    const r = await ready({
      windows: fakeWindows({ recordingCamera: "silent" }),
    });

    await r.goLive();

    await vi.waitFor(() =>
      expect(r.heard.map((m) => m.type)).toContain("recording-stopped")
    );
    await vi.waitFor(() =>
      expect(ended(r.streamStatuses())).toEqual([
        "The Recording Session ended on its own: the camera was lost.",
      ])
    );
    expect(r.windows.streams[0]!.written).toContain("q");
  });
});

/** Every file under `dir`, read whole. */
const everyFile = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile())
    .map((d) => fs.readFileSync(path.join(d.parentPath, d.name), "utf8"));

describe("the Stream Key", () => {
  it("never appears in the service's log, a refusal, events.jsonl or the service's state folder", async () => {
    const logged: string[] = [];
    const keep =
      (write: (...a: unknown[]) => void) =>
      (...a: unknown[]) => {
        logged.push(a.map(String).join(" "));
        write(...a);
      };
    vi.spyOn(console, "log").mockImplementation(keep(() => {}));
    vi.spyOn(console, "error").mockImplementation(keep(() => {}));
    const r = await ready();
    await r.goLive();
    await vi.waitFor(() =>
      expect(r.heard.map((m) => m.type)).toContain("recording-started")
    );

    // ffmpeg names its output URL in its errors when YouTube is unreachable.
    r.windows.streams[0]!.stderr(
      `[tee @ 0001] [error] Slave '[f=flv:onfail=ignore]rtmps://a.rtmps.youtube.com:443/live2/${KEY}': Error opening output rtmps://a.rtmps.youtube.com:443/live2/${KEY}: I/O error\r\n`
    );
    // A second Go Live, straight to the service: refused (recording already).
    const refusal = await r.client
      .goLive(r.video.id, {
        broadcastId: "office-hours",
        streamKey: Redacted.make(KEY),
        micOffsetMs: 0,
        micEq: { lowDb: 0, midDb: 0, highDb: 0 },
        silenceLength: "short",
        folder: r.folder,
      })
      .then(
        () => "",
        (e: unknown) => String(e)
      );
    // A start-stream the service cannot read, cut short mid-key.
    const raw = await connect(r.port);
    raw.send({ type: "start-stream", streamKey: KEY } as never);
    await r.client.endStream(r.video.id);
    await r.client.settled();

    expect(refusal).toContain(GO_LIVE_REFUSALS.recording);
    expect(logged.join("\n")).toContain("Live Stream: [tee @ 0001] [error]");
    expect(logged.join("\n")).toContain("unreadable command");
    const everything = [
      refusal,
      ...logged,
      ...everyFile(r.stateDir),
      ...everyFile(r.folder),
      JSON.stringify(r.heard),
      // Matched in memory: never sent to YouTube.
      ...youtube.calls,
    ].join("\n");
    // The take's own log was among what was read.
    expect(fs.readdirSync(r.folder, { recursive: true }).map(String)).toEqual(
      expect.arrayContaining([expect.stringMatching(/events\.jsonl$/)])
    );
    expect(everything).not.toContain(KEY);
    vi.restoreAllMocks();
  });
});
