import { execFileSync, spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { analysePicture, unwrap } from "./footage-analysis";
import { METRICS, rank, score } from "./metrics";
import { renderJson } from "./report";
import { syntheticFfmpegArgs } from "./synthetic-launcher";
import {
  CLOCK_BITS,
  CLOCK_HEIGHT,
  CLOCK_MOD,
  CLOCK_WIDTH,
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

describe("analysePicture", () => {
  const interval = 1000 / 30;
  const clocks = (ms: number[]) => ms.map((m) => Math.round(m) % CLOCK_MOD);

  it("counts the head's repeats, later repeats and drops", () => {
    const t0 = 1_700_000_000_000;
    const first = t0 + 40;
    const ms = [first, first, first]; // the CFR filter's fill back to T0
    for (let n = 1; n < 100; n++) ms.push(first + n * interval);
    ms.splice(50, 0, ms[49]!); // one repeat, nothing lost
    ms.splice(70, 2); // two dropped
    const report = analysePicture(clocks(ms), { fps: 30, t0Ms: t0 });
    expect(report).toMatchObject({
      leadingRepeats: 2,
      firstCaptureMs: first,
      repeated: 1,
      dropped: 2,
    });
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
});
