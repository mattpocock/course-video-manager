import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { StreamHealth } from "recorder-service/stream-protocol";
import { clock, connect } from "recorder-service/test-utils/service-harness";
import { ended, ready, setupGoLiveTests } from "./go-live-test-harness";
import { startService } from "./recorder-client-test-harness";

/**
 * The Live Stream reconnects for ever, and says how it is doing (spec #2445,
 * stories 46–50), end to end through Go Live (`go-live-test-harness.ts`):
 * whatever its process does, the streamed Recording Session records on,
 * untouched, until End Stream.
 */

setupGoLiveTests();

/** Live, recording, and the take's processes to watch. */
const live = async (o: Parameters<typeof ready>[0] = {}) => {
  const r = await ready(o);
  await r.goLive();
  await vi.waitFor(() =>
    expect(r.heard.map((m) => m.type)).toContain("recording-started")
  );
  const take = {
    screen: r.windows.recorder("screen"),
    writer: r.windows.recorder("camera"),
  };
  /** Nothing asked the take's processes to stop, and they record on. */
  const untouched = () => {
    expect(r.heard.map((m) => m.type)).not.toContain("recording-stopped");
    expect(take.screen.written).toBe("");
    expect(take.writer.written).not.toContain("q");
    expect(take.screen.running && take.writer.running).toBe(true);
  };
  const healths = () =>
    r.heard.flatMap((m): StreamHealth[] =>
      m.type === "stream-health" ? [m.health] : []
    );
  const kinds = () => r.streamStatuses().map((s) => s.kind);
  return { ...r, untouched, healths, kinds };
};

/** One -progress block, as ffmpeg prints it. */
const progress = (o: {
  frame: number;
  outTimeUs?: number;
  fps?: string;
  speed?: string;
  drop?: number;
  dup?: number;
}) =>
  [
    `frame=${o.frame}`,
    `fps=${o.fps ?? "60.00"}`,
    "bitrate=N/A",
    "total_size=N/A",
    `out_time_us=${o.outTimeUs ?? 0}`,
    `dup_frames=${o.dup ?? 0}`,
    `drop_frames=${o.drop ?? 0}`,
    `speed=${o.speed ?? "1x"}`,
    "progress=continue",
    "",
  ].join("\n");

/** The stream's args less its scene and its picture's start: what a relaunch must keep. */
const kept = (args: readonly string[]) =>
  args.map((a) =>
    a
      .replace(/streamselect=inputs=3:map=\d/, "<scene>")
      // Its picture's start: the canvas's, and the card's with it (#2461).
      .replace(/setpts=PTS\+[\d.]+\/TB,/g, "")
      // Its output moved back to 0 by that start (#2482).
      .replace(
        /\[live_unshifted\];\[live_unshifted\]setpts=PTS-[\d.]+\/TB\[v\]/,
        "[v]"
      )
      .replace(/\[1:a\]atrim=start=[\d.]+,asetpts=PTS-[\d.]+\/TB,/, "[1:a]")
  );

/**
 * Where its output's picture and sound start from 0: moved back by its
 * picture's start, or -copyts and CFR fill everything before it with
 * duplicated frames, encoded as fast as NVENC can (#2482).
 */
const outputShift = (args: readonly string[]) => {
  const a = args.join(" ");
  return {
    picture: Number(a.match(/setpts=PTS-([\d.]+)\/TB\[v\]/)?.[1] ?? 0),
    sound: Number(
      a.match(/\[1:a\]atrim=start=([\d.]+),asetpts=PTS-\1\/TB,/)?.[1] ?? 0
    ),
  };
};

/** Where its picture's canvas starts, in the Recording Session's file time. */
const canvasStart = (args: readonly string[]) =>
  Number(args.join(" ").match(/setpts=PTS\+([\d.]+)\/TB/)?.[1] ?? 0);

describe("the stream reconnects for ever, and the recording carries on", () => {
  it("launches a stream process that quits again, and again, from the same Go Live, on the scene of the moment, counting every reconnect, until End Stream", async () => {
    const r = await live();
    const first = r.windows.streams[0]!;
    first.stdout(progress({ frame: 60 }));
    await vi.waitFor(() => expect(r.kinds().at(-1)).toBe("live"));
    await r.client.switchScene(r.video.id, "No Face");
    // 42 s into the take, the writer with it.
    clock.ms += 42_000;
    r.windows
      .recorder("camera")
      .stdout("frame=1259\nout_time_us=42000000\nprogress=continue\n");

    // A crash, or YouTube gone for good in its push.
    first.exit(1);

    await vi.waitFor(() => expect(r.windows.streams).toHaveLength(2));
    const second = r.windows.streams[1]!;
    expect(r.kinds().at(-1)).toBe("reconnecting");
    expect(r.healths().at(-1)?.reconnects).toBe(1);
    // The very Stream Key, ports, Mic Offset and Mic EQ; today's scene.
    expect(kept(second.launch.args)).toEqual(kept(first.launch.args));
    // Its picture starts where the feeds will be once it is up, not at 0,
    // where it would be drawn as fast as it could until it caught up.
    expect(canvasStart(first.launch.args)).toBe(0);
    expect(canvasStart(second.launch.args)).toBe(45);
    expect(outputShift(first.launch.args)).toEqual({ picture: 0, sound: 0 });
    expect(outputShift(second.launch.args)).toEqual({ picture: 45, sound: 45 });
    expect(second.launch.args.join(" ")).toContain(
      "streamselect=inputs=3:map=2"
    );
    r.untouched();

    // It keeps quitting: launched again each time, every reconnect counted.
    second.exit(1);
    await vi.waitFor(() => expect(r.windows.streams).toHaveLength(3), {
      timeout: 3_000,
    });
    const third = r.windows.streams[2]!;
    expect(r.healths().at(-1)?.reconnects).toBe(2);
    expect(ended(r.streamStatuses())).toEqual([]);
    r.untouched();

    third.stdout(progress({ frame: 60 }));
    await vi.waitFor(() => expect(r.kinds().at(-1)).toBe("live"));

    await r.client.endStream(r.video.id);

    await vi.waitFor(() =>
      expect(r.heard).toContainEqual(
        expect.objectContaining({ type: "recording-stopped", errors: [] })
      )
    );
    expect(third.written).toContain("q");
    expect(ended(r.streamStatuses())).toEqual(["End Stream."]);
    // Once ended, nothing is launched again.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(r.windows.streams).toHaveLength(3);
  });

  it("stops a stream process that stalls, and launches it again", async () => {
    const r = await live({ streamStallMs: 100 });
    const first = r.windows.streams[0]!;

    // One block of -progress, then nothing: stalled.
    first.stdout(progress({ frame: 60 }));

    await vi.waitFor(() => expect(r.windows.streams.length).toBeGreaterThan(1));
    expect(first.written).toContain("q");
    expect(first.running).toBe(false);
    r.untouched();
    await r.client.endStream(r.video.id);
  });

  it("says it is reconnecting while its push retries YouTube, and live once through again, counting it", async () => {
    const r = await live();
    const stream = r.windows.streams[0]!;
    stream.stdout(progress({ frame: 60 }));
    await vi.waitFor(() => expect(r.kinds().at(-1)).toBe("live"));

    stream.stderr(
      "[fifo @ 0001] [error] Error opening rtmps://a.rtmps.youtube.com:443/live2/key: I/O error\r\n"
    );
    await vi.waitFor(() => expect(r.kinds().at(-1)).toBe("reconnecting"));
    expect(r.healths().at(-1)?.reconnects).toBe(1);

    stream.stderr("[fifo @ 0001] [info] Recovery successful\r\n");
    await vi.waitFor(() => expect(r.kinds().at(-1)).toBe("live"));

    // Inside the one process: nothing was launched again.
    expect(r.windows.streams).toHaveLength(1);
    r.untouched();
    await r.client.endStream(r.video.id);
  });
});

describe("the Live Stream's health", () => {
  it("says fps, speed, drops, dups and the bitrate pushed, from -progress, and never saves it with the Recording Session", async () => {
    const r = await live();
    const stream = r.windows.streams[0]!;

    stream.stdout(progress({ frame: 60, fps: "60.18", speed: "0.998x" }));
    // A second of packets: 1,125,000 bytes is 9,000 kbit/s.
    stream.stderr("cvm-packet 1000000\r\ncvm-packet 125000\r\n");
    stream.stdout(
      progress({ frame: 120, outTimeUs: 500_000, drop: 9, dup: 9 })
    );
    stream.stdout(
      progress({ frame: 180, outTimeUs: 1_000_000, drop: 2, dup: 1 })
    );

    await vi.waitFor(() => expect(r.healths()).toHaveLength(2));
    expect(r.healths()).toEqual([
      {
        fps: 60.18,
        speed: 0.998,
        droppedFrames: 0,
        duplicatedFrames: 0,
        bitrateKbps: null,
        reconnects: 0,
      },
      {
        fps: 60,
        speed: 1,
        droppedFrames: 2,
        duplicatedFrames: 1,
        bitrateKbps: 9_000,
        reconnects: 0,
      },
    ]);

    await r.client.endStream(r.video.id);
    await r.client.settled();
    const logs = fs
      .readdirSync(r.folder, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith("events.jsonl"));
    expect(logs).not.toEqual([]);
    for (const log of logs)
      expect(fs.readFileSync(path.join(r.folder, log), "utf8")).not.toMatch(
        /stream-health|bitrate|reconnect/
      );
  });
});

describe("a Live Stream left behind", () => {
  it("is stopped when the next recorder service starts, as any recorder process is", async () => {
    const r = await live();
    const orphan = r.windows.streams[0]!;

    // The service died; the next one starts on the same Windows.
    const next = await startService(r.stateDir, r.windows);
    await (await connect(next.port)).next("hello");

    expect(orphan.running).toBe(false);
  });
});
