import { NodeContext } from "@effect/platform-node";
import { Effect } from "effect";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loudestMs } from "@/packages/clap-step";
import {
  cameraFrameJpeg,
  clapPreviewMp4,
  readMicSamples,
} from "@/packages/clap-step/server";
import { nowMs } from "@/packages/clock";

/**
 * A synthetic AV Calibration take, made with ffmpeg and no device: a mic file
 * (48 kHz stereo 16-bit WAV, as the run writes it) with a clap at each
 * `audioS`, and a camera file (29.97 fps, as the run writes it) in which two
 * "hands" close in at a steady speed and meet at each `videoS`, rest a moment,
 * then part. Light noise in both, so nothing is perfectly still.
 *
 * The two ways 2026-10-12's real calibrations lost claps can be added: a
 * louder room (`hissDb`), so each clap rises only ~25 dB over it, and Matt
 * swaying the whole time (`sway`), a body at the frame's edge moving back
 * and forth. And the way their Mic Offset went wrong: a start-up gap
 * (`gap`), a run of exact silence in the mic just after it starts.
 */

const SAMPLE_RATE = 48_000;
const FPS_NUM = 30_000;
const FPS_DEN = 1001;
const W = 640;
const H = 360;
/** How long the hands take to close, rest together, and part, in s. */
const CLOSE_S = 0.25;
const REST_S = 0.15;
const PART_S = 0.5;
const OPEN_GAP = 240;
/** The swaying body: its width, how far its edge sways, and how often, in px and s. */
const BODY_W = 100;
const BODY_SWAY = 40;
const SWAY_PERIOD_S = 1.1;

/** A seeded random in [0, 1), so a fixture is the same every run. */
const random = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

const writeSyntheticTake = (o: {
  dir: string;
  durationS: number;
  audioS: readonly number[];
  videoS: readonly number[];
  hissDb?: number;
  sway?: boolean;
  gap?: { atS: number; ms: number };
}) => {
  const rand = random(42);

  // The mic: a hiss (-65 dBFS by default), and each clap a 0.3 ms rise into
  // a noise burst that dies away with an 8 ms time constant.
  const n = Math.round(o.durationS * SAMPLE_RATE);
  const mic = new Float32Array(n * 2);
  const hiss = 10 ** ((o.hissDb ?? -65) / 20);
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    if (o.gap && t >= o.gap.atS && t < o.gap.atS + o.gap.ms / 1000) continue;
    let x = (rand() - 0.5) * 2 * hiss;
    for (const a of o.audioS) {
      const dt = t - a;
      if (dt < 0 || dt > 0.2) continue;
      x +=
        0.6 *
        Math.min(dt / 0.0003, 1) *
        Math.exp(-dt / 0.008) *
        (rand() - 0.5) *
        2;
    }
    mic[i * 2] = x;
    mic[i * 2 + 1] = x;
  }
  const rawMic = path.join(o.dir, "mic.f32");
  writeFileSync(rawMic, Buffer.from(mic.buffer));
  const micFile = path.join(o.dir, "mic.wav");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-v",
    "error",
    "-y",
    "-f",
    "f32le",
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    "2",
    "-i",
    rawMic,
    "-c:a",
    "pcm_s16le",
    micFile,
  ]);

  // The camera: the gap between the hands at frame time t.
  const gapAt = (t: number) => {
    let gap = OPEN_GAP;
    for (const c of o.videoS) {
      const dt = t - c;
      if (dt >= -CLOSE_S && dt < 0)
        gap = Math.min(gap, (-dt / CLOSE_S) * OPEN_GAP);
      else if (dt >= 0 && dt < REST_S) gap = 0;
      else if (dt >= REST_S && dt < REST_S + PART_S)
        gap = Math.min(gap, ((dt - REST_S) / PART_S) * OPEN_GAP);
    }
    return gap;
  };
  const frames = Math.floor((o.durationS * FPS_NUM) / FPS_DEN);
  const video = Buffer.alloc(frames * W * H);
  const handW = 90;
  const top = 100;
  const bottom = 260;
  for (let f = 0; f < frames; f++) {
    const t = (f * FPS_DEN) / FPS_NUM;
    const gap = gapAt(t);
    const leftEdge = W / 2 - gap / 2;
    const rightEdge = W / 2 + gap / 2;
    // The swaying body's edge, at the frame's right.
    const bodyEdge = o.sway
      ? W - BODY_W + BODY_SWAY * Math.sin((2 * Math.PI * t) / SWAY_PERIOD_S)
      : W;
    const frame = video.subarray(f * W * H, (f + 1) * W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const hand =
          y >= top &&
          y < bottom &&
          ((x >= leftEdge - handW && x < leftEdge) ||
            (x >= rightEdge && x < rightEdge + handW));
        const body = x >= bodyEdge;
        frame[y * W + x] =
          (hand ? 200 : body ? 160 : 60) + Math.floor(rand() * 4);
      }
    }
  }
  const rawCamera = path.join(o.dir, "camera.gray");
  writeFileSync(rawCamera, video);
  const cameraFile = path.join(o.dir, "camera.mkv");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-v",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "gray",
    "-s",
    `${W}x${H}`,
    "-framerate",
    `${FPS_NUM}/${FPS_DEN}`,
    "-i",
    rawCamera,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    cameraFile,
  ]);
  return { micFile, cameraFile };
};

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const run = <A, E>(effect: Effect.Effect<A, E, never>) =>
  Effect.runPromise(effect);

/**
 * The real ffmpeg over a synthetic take (no device): one clap the mic hears
 * at 2.013 s, the hands meeting on camera 120 ms later.
 */
describe.skipIf(!hasFfmpeg)("the clap step over real files", () => {
  const dir = path.join(tmpdir(), `clap-step-${process.pid}-${nowMs()}`);
  let files: { micFile: string; cameraFile: string };
  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    files = writeSyntheticTake({
      dir,
      durationS: 4,
      audioS: [2.013],
      videoS: [2.133],
    });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("finds the clap as the loudest point of the mic, to the ms", async () => {
    const samples = await run(
      readMicSamples({
        micFile: files.micFile,
        fromMs: 1000,
        toMs: 3000,
        sampleRate: 48_000,
      }).pipe(Effect.provide(NodeContext.layer))
    );
    expect(samples.length).toBe(2 * 48_000);
    const at = 1000 + loudestMs(samples, 48_000);
    expect(at).toBeGreaterThanOrEqual(2013);
    expect(at).toBeLessThan(2013 + 15);
  });

  it("answers one camera frame as a JPEG", async () => {
    const jpeg = await run(
      cameraFrameJpeg({ cameraFile: files.cameraFile, frame: 64 }).pipe(
        Effect.provide(NodeContext.layer)
      )
    );
    expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    writeFileSync(path.join(dir, "frame.jpg"), jpeg);
    const size = execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      path.join(dir, "frame.jpg"),
    ])
      .toString()
      .trim();
    expect(size).toBe("640,360");
  });

  it("makes Play's 2 s clip with sound and picture", async () => {
    const mp4 = await run(
      clapPreviewMp4({
        ...files,
        videoMs: 2133,
        micOffsetMs: 120,
      }).pipe(Effect.provide(NodeContext.layer))
    );
    const file = path.join(dir, "play.mp4");
    writeFileSync(file, mp4);
    const streams = execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type",
      "-of",
      "csv=p=0",
      file,
    ])
      .toString()
      .trim()
      .split("\n");
    expect(streams.sort()).toEqual(["audio", "video"]);
  });

  // NVDEC and NVENC first; on a machine with no usable GPU (CI, a driver
  // gone after sleep) the same calls fall back to the CPU. Hiding the device
  // from CUDA makes this machine one.
  describe("with no usable GPU", () => {
    beforeAll(() => {
      vi.stubEnv("CUDA_VISIBLE_DEVICES", "-1");
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it("still answers a camera frame", async () => {
      const jpeg = await run(
        cameraFrameJpeg({ cameraFile: files.cameraFile, frame: 64 }).pipe(
          Effect.provide(NodeContext.layer)
        )
      );
      expect([...jpeg.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    });

    it("still makes Play's clip, on libx264", async () => {
      const mp4 = await run(
        clapPreviewMp4({
          ...files,
          videoMs: 2133,
          micOffsetMs: 120,
        }).pipe(Effect.provide(NodeContext.layer))
      );
      const file = path.join(dir, "play-cpu.mp4");
      writeFileSync(file, mp4);
      const codec = execFileSync("ffprobe", [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name",
        "-of",
        "csv=p=0",
        file,
      ])
        .toString()
        .trim();
      expect(codec).toBe("h264");
      // libx264 signs its stream; NVENC does not.
      expect(Buffer.from(mp4).includes("x264 - core")).toBe(true);
    });
  });
});
