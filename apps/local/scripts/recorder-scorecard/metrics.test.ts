import { execFileSync, spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { analysePicture, readStamp, unwrap } from "./footage-analysis";
import { METRICS, rank, score } from "./metrics";
import { renderJson } from "./report";
import {
  leastDelayedClock,
  onlyToSink,
  readProgress,
  streamRate,
} from "./stream-sink";
import { syntheticFfmpegArgs } from "./synthetic-launcher";
import {
  CAMERA_FPS,
  CAMERA_SOURCE,
  CLOCK_BITS,
  CLOCK_HEIGHT,
  CLOCK_MOD,
  CLOCK_WIDTH,
  INDEX_MOD,
  SCREEN_SOURCE,
  clockBitCentre,
} from "./synthetic-sources";
import {
  cameraCaptureArgs,
  screenPreviewArgs,
} from "../../recorder-service/capture-args";
import { screenRecorderArgs } from "../../recorder-service/take-args";

const def = (id: string) => METRICS.find((m) => m.id === id)!;

describe("score", () => {
  it("holds CVM to the stricter of its target and OBS", () => {
    // Target 70 ms, OBS 89 ms: the target is stricter.
    expect(score(def("preview_screen_take_p50_ms"), 80)).toMatchObject({
      bar: 70,
      status: "fail",
      vsObs: "better-or-equal",
    });
    // Target 10 ms, OBS 0.3 ms: OBS is stricter.
    expect(score(def("av_drift_ms"), 5)).toMatchObject({
      bar: 0.3,
      status: "fail",
      vsObs: "worse",
    });
  });

  it("calls a metric with no OBS evidence unknown against OBS, never a pass", () => {
    expect(score(def("record_ack_ms"), 20)).toMatchObject({
      status: "pass",
      vsObs: "unknown",
      obs: null,
    });
  });

  it("scores a metric where higher is better", () => {
    expect(score(def("crash_files_playable"), 2)).toMatchObject({
      status: "fail",
      gap: 1,
    });
  });

  it("leaves a metric that was not measured unscored", () => {
    expect(score(def("disk_full"), null)).toMatchObject({
      status: "unmeasured",
      gap: 0,
    });
  });
});

describe("rank", () => {
  it("puts failures first, widest gap (in each metric's own scale) first", () => {
    const rows = rank({
      record_ack_ms: 200, // 100 over a bar of 100, scale 50: gap 2
      camera_dropped_frames: 5, // 5 over a bar of 0, scale 1: gap 5
      stop_to_open_ms: 100, // passes
    });
    expect(rows.slice(0, 2).map((r) => r.id)).toEqual([
      "camera_dropped_frames",
      "record_ack_ms",
    ]);
    expect(rows.at(-1)!.status).toBe("pass");
  });
});

describe("renderJson", () => {
  it("lists every metric on a line of its own, in a fixed order, so runs diff", () => {
    const json = renderJson(
      {
        startedAt: "t",
        mode: "quick",
        commit: "abc",
        longTakeSeconds: 60,
        cycles: 10,
        wallSeconds: 1,
        notes: [],
      },
      { record_ack_ms: 200 },
      {}
    );
    const parsed = JSON.parse(json) as {
      ranking: string[];
      metrics: Record<string, unknown>;
    };
    expect(Object.keys(parsed.metrics)).toEqual(METRICS.map((m) => m.id));
    expect(parsed.ranking).toEqual(["record_ack_ms"]);
    expect(json).toContain('    "record_ack_ms": {"value":200,');
  });
});

describe("the Live Stream's -progress", () => {
  /** One -progress block, as ffmpeg.exe prints it each second. */
  const block = (frame: number, dup = 0, drop = 0) =>
    `frame=${frame}\nfps=60.12\ndup_frames=${dup}\ndrop_frames=${drop}\nprogress=continue\n`;

  it("measures frames per second of wall time, however late each block arrives", () => {
    const progress = readProgress();
    // 60 fps for 100 s; each block reaches the scorecard up to 80 ms late.
    for (let s = 0; s <= 100; s++)
      progress.push(block(60 * s), 1000 * s + ((s * 37) % 81));
    expect(streamRate(progress.samples, 0)).toBeCloseTo(60, 1);
  });

  it("measures on the Windows clock its frames are stamped on, not WSL's, which wanders (#2482)", () => {
    const progress = readProgress();
    // 60 fps for 100 s of Windows time; WSL's clock runs 0.2% fast and
    // steps 250 ms back halfway, as the rig's does under load.
    for (let s = 0; s <= 100; s++) {
      const wsl = 1002 * s - (s >= 50 ? 250 : 0);
      progress.push(block(60 * s), wsl, 1_000_000 + 1000 * s);
    }
    expect(streamRate(progress.samples, 0)).toBeCloseTo(60, 3);
  });

  it("reads past blocks and Windows ticks that arrive late, as both do under load (#2482)", () => {
    const progress = readProgress();
    const clock = leastDelayedClock();
    const late = (i: number) => ((i * 7919) % 200) * (i % 3 === 0 ? 1 : 0.2);
    // Windows' clock is 1e6 ms ahead of WSL's; every tick and block is late.
    for (let ms = 0; ms <= 100_000; ms += 20)
      clock.tick(1_000_000 + ms, ms + late(ms / 20));
    // Blocks are later still while the card checks load WSL (the first half).
    for (let i = 0; i <= 2000; i++) {
      const at = 50 * i + late(i) * (i < 1000 && i % 3 === 0 ? 2 : 1);
      progress.push(block(3 * i), at, clock.now(at));
    }
    expect(clock.now(50_000)).toBeCloseTo(1_050_000, -1);
    expect(streamRate(progress.samples, 0)).toBeCloseTo(60, 2);
  });

  it("measures only from the moment given (a stream warming up runs slow)", () => {
    const progress = readProgress();
    for (let s = 0; s <= 10; s++) progress.push(block(30 * s), 1000 * s);
    for (let s = 11; s <= 60; s++)
      progress.push(block(300 + 60 * (s - 10)), 1000 * s);
    expect(streamRate(progress.samples, 11_000)).toBeCloseTo(60, 5);
  });

  it("keeps the latest duplicated and dropped frame counts, even split across chunks", () => {
    const progress = readProgress();
    const text = block(60) + block(120, 2, 3);
    progress.push(text.slice(0, 50), 1000);
    progress.push(text.slice(50), 2000);
    expect(progress.samples.at(-1)).toMatchObject({
      frame: 120,
      dupFrames: 2,
      dropFrames: 3,
    });
  });
});

describe("onlyToSink", () => {
  const launched: string[][] = [];
  const launcher = onlyToSink((l) => {
    if (l.tool === "ffmpeg") launched.push([...l.args]);
    return {
      onStdout: () => {},
      onStderr: () => {},
      writeStdin: () => {},
      exited: Promise.resolve(0),
      kill: () => {},
    };
  }, "rtmp://127.0.0.1:19350/live");
  const stream = (url: string) => [
    "-metadata",
    "comment=cvm-recorder-stream",
    "-f",
    "tee",
    `[f=flv:onfail=ignore]${url}|[f=null:use_fifo=0]-`,
  ];

  it("never starts a Live Stream aimed anywhere but the local sink", async () => {
    const p = launcher({
      tool: "ffmpeg",
      args: stream("rtmps://a.rtmps.youtube.com:443/live2/key"),
      cwd: "/mnt/c",
    });
    expect(await p.exited).toBe(1);
    expect(launched).toEqual([]);
  });

  it("starts a Live Stream aimed at the local sink, and every other process", () => {
    launcher({
      tool: "ffmpeg",
      args: stream("rtmp://127.0.0.1:19350/live/key"),
      cwd: "/mnt/c",
    });
    launcher({ tool: "ffmpeg", args: ["-i", "x"], cwd: "/mnt/c" });
    expect(launched).toHaveLength(2);
  });
});

describe("analysePicture", () => {
  const interval = 1000 / 30;
  const t0 = 1_700_000_000_000;
  const first = t0 + 40;
  /** Frame `i` of the source, made at `ms`. */
  const stamp = (i: number, ms: number) => ({
    clock: Math.round(ms) % CLOCK_MOD,
    index: i % INDEX_MOD,
  });
  /** `n` frames made on time from index `from`. */
  const onTime = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) =>
      stamp(from + i, first + (from + i) * interval)
    );

  it("counts the head's repeats, later repeats and drops by index", () => {
    const frames = [stamp(0, first), stamp(0, first), ...onTime(100)]; // the CFR filter's fill back to T0
    frames.splice(52, 0, frames[51]!); // one repeat, nothing lost
    frames.splice(72, 2); // two dropped
    const report = analysePicture(frames, { fps: 30, t0Ms: t0 });
    expect(report).toMatchObject({
      leadingRepeats: 2,
      firstCaptureMs: first,
      repeated: 1,
      dropped: 2,
      unreadable: 0,
    });
  });

  it("reads a starved source's late, bunched frames as a stall, not as drops or repeats", () => {
    // Frames 40-49 come 300 ms late, then back to back (realtime catching
    // up): the clock jumps and bunches, every index is there once.
    const frames = onTime(100).map((f, i) =>
      i >= 40 && i < 50
        ? stamp(i, first + 40 * interval + 300 + (i - 40) * 0.4)
        : f
    );
    const report = analysePicture(frames, { fps: 30, t0Ms: t0 });
    expect(report).toMatchObject({ repeated: 0, dropped: 0 });
    expect(report.sourceStalls.frames).toBeGreaterThan(0);
    expect(report.sourceStalls.longestMs).toBeGreaterThan(300);
  });

  it("leaves a misread frame out without calling it a drop or a repeat", () => {
    const frames = onTime(100);
    frames[30] = { ...frames[30]!, index: frames[30]!.index ^ 0x200 };
    const report = analysePicture(frames, { fps: 30, t0Ms: t0 });
    expect(report).toMatchObject({ unreadable: 1, repeated: 0, dropped: 0 });
  });

  it("unwraps the index across its 14-bit wrap", () => {
    const frames = onTime(40, INDEX_MOD - 20);
    frames.splice(25, 1); // one dropped, just after the wrap
    const report = analysePicture(frames, { fps: 30, t0Ms: t0 });
    expect(report).toMatchObject({ dropped: 1, repeated: 0, unreadable: 0 });
  });

  it("unwraps the 28-bit clock to the nearest full time", () => {
    const near = 1_792_000_000_000;
    expect(unwrap((near + 5) % CLOCK_MOD, near)).toBe(near + 5);
    expect(unwrap((near - 5) % CLOCK_MOD, near)).toBe(near - 5);
  });
});

describe("syntheticFfmpegArgs", () => {
  const marker = "cvm-scorecard-test";

  it("swaps the Cam Link and the mic for synthetic sources, and marks the process", () => {
    const real = cameraCaptureArgs({
      camera: "Cam Link 4K",
      mic: "Voicemeeter Out B1",
      relays: { preview: 23000, writer: 23001 },
    });
    const args = syntheticFfmpegArgs(real, marker);
    expect(args).not.toContain("dshow");
    expect(args.join(" ")).not.toMatch(/video=|audio=/);
    expect(args.filter((a) => a === "lavfi")).toHaveLength(2);
    // The picture keeps its own stamps; the mic keeps the wall clock's.
    expect(
      args.filter((a) => a === "-use_wallclock_as_timestamps")
    ).toHaveLength(1);
    expect(args.indexOf("-use_wallclock_as_timestamps")).toBeGreaterThan(
      args.indexOf("lavfi")
    );
    expect(args.find((a) => a.startsWith("[0:v]"))).toMatch(
      /^\[0:v\]format=nv12,hwupload_cuda,scale_cuda=3840:2160/
    );
    expect(args.filter((a) => a.startsWith("comment="))).toEqual(
      real.filter((a) => a.startsWith("comment=")).map((a) => `${a} ${marker}`)
    );
  });

  it("swaps ddagrab for a synthetic screen in the screen recorder and its preview", () => {
    const recorder = syntheticFfmpegArgs(
      screenRecorderArgs({ t0Ms: 1, tag: "cvm-recorder-x", screenIndex: 0 }),
      marker
    );
    const preview = syntheticFfmpegArgs(
      screenPreviewArgs({ screenIndex: 0, port: 1, encoder: "nvenc" }),
      marker
    );
    for (const args of [recorder, preview]) {
      expect(args.join(" ")).not.toContain("ddagrab");
      expect(args).toContain("-filter_hw_device");
      // On the NVIDIA GPU, as ddagrab's DELL frame is: DXGI's default
      // adapter can be the Ryzen iGPU, where NVENC will not open (#2441).
      expect(args[args.indexOf("-init_hw_device") + 1]).toMatch(
        /^d3d11va=scd3d:,vendor_id=0x10de$/
      );
    }
    expect(preview).toContain("[scsv]");
    expect(recorder.find((a) => a.startsWith("[0:v]"))).toMatch(
      /^\[0:v\]hwupload,scale_d3d11=1920:1080:format=nv12,setpts=/
    );
  });
});

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)("the synthetic screen in ffmpeg", () => {
  /**
   * Reads the screen source's clock as each frame arrives, with the reader
   * stalled for `stallMs` after the first second: a stand-in for a starved
   * source. Each read is how far the burned clock is behind the wall.
   */
  const behindAfterStall = (stallMs: number) =>
    new Promise<number[]>((resolve, reject) => {
      const child = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          SCREEN_SOURCE,
        ].concat(["-pix_fmt", "gray", "-f", "rawvideo", "-"]),
        { stdio: ["ignore", "pipe", "ignore"] }
      );
      const size = CLOCK_WIDTH * CLOCK_HEIGHT;
      const behind: number[] = [];
      let pending = Buffer.alloc(0);
      let stalled = false;
      const started = Date.now();
      child.stdout.on("data", (d: Buffer) => {
        pending = Buffer.concat([pending, d]);
        while (pending.length >= size) {
          let v = 0;
          for (let k = 0; k < CLOCK_BITS; k++) {
            const { x, y } = clockBitCentre(k);
            if (pending[y * CLOCK_WIDTH + x]! > 128) v += 2 ** k;
          }
          pending = pending.subarray(size);
          if (stalled) behind.push((Date.now() - v) % CLOCK_MOD);
        }
        if (!stalled && Date.now() - started > 1000) {
          stalled = true;
          child.stdout.pause();
          setTimeout(() => child.stdout.resume(), stallMs);
          setTimeout(() => child.kill("SIGKILL"), stallMs + 1000);
        }
      });
      child.once("error", reject);
      child.once("close", () => resolve(behind));
    });

  it("stamps a frame when it is made, so a stalled source has no backlog", async () => {
    const behind = await behindAfterStall(2000);
    // What sat in ffmpeg's queues and the pipe through the stall is late;
    // nothing made after it is. Due-time stamps put ~120 frames behind.
    expect(behind.filter((ms) => ms > 500).length).toBeLessThan(30);
    expect(behind.slice(-30).every((ms) => ms < 200)).toBe(true);
  });

  /**
   * Every frame of the camera source, with the reader stalled for `stallMs`
   * after the first second: the source starved, as at Idle priority.
   */
  const stampsAroundStall = (stallMs: number) =>
    new Promise<ReturnType<typeof readStamp>[]>((resolve, reject) => {
      const child = spawn(
        "ffmpeg",
        [
          "-hide_banner",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          CAMERA_SOURCE,
        ].concat(["-pix_fmt", "gray", "-f", "rawvideo", "-"]),
        { stdio: ["ignore", "pipe", "ignore"] }
      );
      const size = CLOCK_WIDTH * CLOCK_HEIGHT;
      const stamps: ReturnType<typeof readStamp>[] = [];
      let pending = Buffer.alloc(0);
      let stalled = false;
      const started = Date.now();
      child.stdout.on("data", (d: Buffer) => {
        pending = Buffer.concat([pending, d]);
        while (pending.length >= size) {
          stamps.push(readStamp(pending.subarray(0, size)));
          pending = pending.subarray(size);
        }
        if (!stalled && Date.now() - started > 1000) {
          stalled = true;
          child.stdout.pause();
          setTimeout(() => child.stdout.resume(), stallMs);
          setTimeout(() => child.kill("SIGKILL"), stallMs + 1500);
        }
      });
      child.once("error", reject);
      child.once("close", () => resolve(stamps));
    });

  it("a stalled source loses no frame: its index runs on while its clock jumps (#2239)", async () => {
    const stamps = await stampsAroundStall(1500);
    const report = analysePicture(stamps, {
      fps: CAMERA_FPS,
      t0Ms: Date.now(),
    });
    // Read from the clock, as before, the stall scored as dozens of drops.
    expect(report.sourceStalls.frames).toBeGreaterThan(10);
    expect(report).toMatchObject({ dropped: 0, repeated: 0, unreadable: 0 });
  });
});
