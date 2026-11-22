import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cameraWriterArgs,
  graphUpCommand,
  takeStartCommand,
} from "./take-args";

/**
 * THE CAMERA WRITER'S OWN GRAPH IN THE REAL FFMPEG (#2442): the very
 * `-filter_complex` the writer runs, asked `graphUpCommand` until it
 * answers and then given Record's T0, as `writer-graph.ts` and the
 * Recording Session do. A command sent to every filter reached the CFR's
 * own `setpts` too, and the graph-up check reset it to the unarmed clock:
 * camera.mkv got no frame at all, while `camera-cfr.ffmpeg.test.ts`, which
 * never sends a command, stayed green.
 *
 * The camera stands in at 29.97 fps, stamped on Windows wall time and
 * rounded to the millisecond as the writer relay rounds it, each frame's
 * index in its pixel value; the mic is silence with a tone from 3 s on.
 * Each T0 phase is checked for frames dropped and repeated, and for the
 * picture and the tone landing where their wall times say. Linux, no GPU;
 * skipped where there is no ffmpeg.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const FPS = 30000 / 1001;
/** Windows wall time of the stand-ins' first frame and sample, in seconds. */
const WALL = 1_000;
/** The frame T0 is put just before (by the phase). */
const FIRST = 60;
/** The frame and the sample, in seconds from the stand-ins' start, the tone starts at. */
const TONE_FRAME = 90;
const TONE_S = 3;
const SECONDS = 5;
const RATE = 48_000;

const writerGraph = () => {
  const argv = cameraWriterArgs({
    relayPort: 0,
    tag: "test",
    silenceLength: "short",
    thresholdDb: -40,
  });
  return argv[argv.indexOf("-filter_complex") + 1]!;
};

const SOURCES = [
  `color=c=black:s=16x2:r=30000/1001:d=${SECONDS},format=gray,geq=lum='mod(N\\,256)',` +
    `settb=AVTB,setpts=PTS+${WALL}/TB,setpts='round(T*1000)/1000/TB',realtime[out0]`,
  `aevalsrc='if(gte(t\\,${TONE_S})\\,0.5*sin(2*PI*440*t)\\,0)':s=${RATE}:n=960:d=${SECONDS},` +
    `asettb=AVTB,asetpts=PTS+${WALL}/TB,arealtime[out1]`,
].join(";");

/** One take with its first frame `phaseMs` after T0. */
const take = async (phaseMs: number) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-writer-graph-"));
  const t0Ms = Math.round((WALL + FIRST / FPS) * 1000 - phaseMs);
  const child = spawn(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "level+info",
      "-stats_period",
      "0.05",
      "-copyts",
      "-f",
      "lavfi",
      "-i",
      SOURCES,
      "-filter_complex",
      writerGraph(),
      "-map",
      "[cam]",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      path.join(dir, "cam.raw"),
      "-map",
      "[mic]",
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      String(RATE),
      path.join(dir, "mic.raw"),
    ],
    { stdio: ["pipe", "ignore", "pipe"] }
  );
  child.stdin.on("error", () => {});
  let answered = false;
  const asking = setInterval(() => child.stdin.write(graphUpCommand), 100);
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text: string) => {
    if (answered || !/Command reply for stream/.test(text)) return;
    answered = true;
    clearInterval(asking);
    child.stdin.write(takeStartCommand(t0Ms));
  });
  const code = await new Promise<number | null>((r) => child.on("exit", r));
  clearInterval(asking);

  const cam = fs.readFileSync(path.join(dir, "cam.raw"));
  const mic = fs.readFileSync(path.join(dir, "mic.raw"));
  fs.rmSync(dir, { recursive: true, force: true });

  const index = Array.from({ length: cam.length / 32 }, (_, k) => cam[k * 32]!);
  let dropped = 0;
  let repeated = 0;
  for (let k = 1; k < index.length; k++) {
    const step = (index[k]! - index[k - 1]! + 256) % 256;
    if (step === 0) repeated++;
    else dropped += step - 1;
  }
  // File time is wall time less T0.
  const fileTime = (wallSeconds: number) => wallSeconds - t0Ms / 1000;
  const toneTick = index.indexOf(TONE_FRAME);
  let toneSample = -1;
  for (let i = 0; i < mic.length / 2; i++)
    if (Math.abs(mic.readInt16LE(i * 2)) > 1_000) {
      toneSample = i;
      break;
    }
  // camera.mkv starts on the frame nearest T0, as its relay stamps put it.
  const stampMs = (n: number) => Math.round((WALL + n / FPS) * 1000);
  const nearest =
    t0Ms - stampMs(FIRST - 1) < stampMs(FIRST) - t0Ms ? FIRST - 1 : FIRST;
  return {
    phaseMs,
    code,
    nearest,
    frames: index.length,
    first: index[0],
    dropped,
    repeated,
    // How far each sits from where its wall time puts it, in ms.
    pictureOffMs: (toneTick / FPS - fileTime(WALL + TONE_FRAME / FPS)) * 1000,
    toneOffMs: (toneSample / RATE - fileTime(WALL + TONE_S)) * 1000,
  };
};

describe.skipIf(!hasFfmpeg)("the camera writer's graph in ffmpeg", () => {
  it("writes every frame from T0, none dropped or repeated, picture and mic on their wall times, wherever T0 falls", async () => {
    const results = await Promise.all(
      [0, 8, 16, 16.7, 17, 25].map((phaseMs) => take(phaseMs))
    );
    for (const r of results) {
      expect({
        phaseMs: r.phaseMs,
        code: r.code,
        first: r.first,
        dropped: r.dropped,
        repeated: r.repeated,
      }).toEqual({
        phaseMs: r.phaseMs,
        code: 0,
        first: r.nearest,
        dropped: 0,
        repeated: 0,
      });
      expect(r.frames).toBeGreaterThan((SECONDS - FIRST / FPS) * FPS - 5);
      // Each frame sits on its nearest tick: at most half a frame off.
      expect(Math.abs(r.pictureOffMs)).toBeLessThanOrEqual(500 / FPS + 1);
      expect(Math.abs(r.toneOffMs)).toBeLessThanOrEqual(5);
    }
  }, 60_000);
});
