import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Either, Redacted } from "effect";
import { STREAM_KEY_MISSING } from "@/services/stream-key.server";
import { broadcastRefusal } from "@/features/streaming/broadcast";
import { GO_LIVE_REFUSALS } from "recorder-service/stream-protocol";
import {
  CALIBRATION,
  connect,
} from "recorder-service/test-utils/service-harness";
import {
  fakeWindows,
  writesFile,
} from "recorder-service/test-utils/fake-windows";
import type { Launch } from "recorder-service/launcher";
import { readSession } from "./recorder-client-test-harness";
import { NO_BROADCAST, NO_MATCHING_STREAM } from "./go-live.server";
import {
  binds,
  broadcast,
  ended,
  envFile,
  isFfmpeg,
  isScreenRecorder,
  isStream,
  isStreamedWriter,
  KEY,
  KEYS_STREAM,
  ports,
  ready,
  reasonsOf,
  setupGoLiveTests,
  youtube,
  youtubeStream,
} from "./go-live-test-harness";

/**
 * Go Live and End Stream end to end (ADR 0054), without hardware
 * (`go-live-test-harness.ts`).
 */

setupGoLiveTests();

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

describe("scene switches while live", () => {
  it("starts the Live Stream on the scene the preview shows", async () => {
    const r = await ready();
    await r.client.switchScene(r.video.id, "No Face");

    await r.goLive();

    // streamselect's map: Camera 0, Code 1, No Face 2.
    expect(r.windows.streams[0]!.launch.args.join(" ")).toContain(
      "streamselect=inputs=3:map=2"
    );
  });

  it("sends every switch, from the editor or the Stream Deck, to the running stream process at once, never relaunching it", async () => {
    const r = await ready();
    await r.goLive();
    const deck = await connect(r.port);

    await r.client.switchScene(r.video.id, "Camera");
    deck.send({
      type: "stream-deck",
      press: { action: "switch-scene", scene: "No Face" },
    });
    await vi.waitFor(() =>
      expect(r.heard).toContainEqual({
        type: "scene-changed",
        scene: "No Face",
      })
    );

    // ffmpeg's `C` on stdin, sent now (-1).
    expect(r.windows.streams[0]!.written).toBe(
      "Cstreamselect -1 map 0\nCstreamselect -1 map 2\n"
    );
    expect(r.windows.launched.filter(isStream)).toHaveLength(1);
    await r.client.endStream(r.video.id);
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
    await r.client.endStream(r.video.id);
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
