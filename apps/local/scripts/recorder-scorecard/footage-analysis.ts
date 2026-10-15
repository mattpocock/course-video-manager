import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  BURST_PERIOD_SECONDS,
  CLOCK_BITS,
  CLOCK_HEIGHT,
  CLOCK_MOD,
  CLOCK_WIDTH,
  INDEX_BITS,
  INDEX_MOD,
  clockBitCentre,
  indexBitCentre,
} from "./synthetic-sources";

/**
 * Reading a take's Footage back (Linux ffmpeg in WSL, on the GPU when it
 * can): each picture frame's burned-in capture time, the mic's first sound
 * and its bursts' onsets, and whether a file plays at all.
 */

const FRAME_BYTES = CLOCK_WIDTH * CLOCK_HEIGHT;

const readBits = (
  frame: Buffer,
  bits: number,
  centre: (k: number) => { x: number; y: number }
) => {
  let v = 0;
  for (let k = 0; k < bits; k++) {
    const { x, y } = centre(k);
    if (frame[y * CLOCK_WIDTH + x]! > 128) v += 2 ** k;
  }
  return v;
};

/** What a frame's blocks say: its clock (ms, mod 2^28) and its index (mod 2^14). */
export type FrameStamp = { clock: number; index: number };

/** Reads a 320x180 grey frame's clock and index. */
export const readStamp = (frame: Buffer): FrameStamp => ({
  clock: readBits(frame, CLOCK_BITS, clockBitCentre),
  index: readBits(frame, INDEX_BITS, indexBitCentre),
});

const decodeArgs = (file: string, gpu: boolean) => [
  "-hide_banner",
  "-v",
  "error",
  ...(gpu ? ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"] : []),
  "-i",
  file,
  "-map",
  "0:v:0",
  "-vf",
  gpu
    ? `scale_cuda=${CLOCK_WIDTH}:${CLOCK_HEIGHT}:interp_algo=bilinear,hwdownload,format=nv12,format=gray`
    : `scale=${CLOCK_WIDTH}:${CLOCK_HEIGHT}:flags=area,format=gray`,
  "-f",
  "rawvideo",
  "-",
];

const decodeWith = (file: string, gpu: boolean) =>
  new Promise<FrameStamp[] | null>((resolve) => {
    const child = spawn("ffmpeg", decodeArgs(file, gpu), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const values: FrameStamp[] = [];
    let pending = Buffer.alloc(0);
    child.stdout.on("data", (d: Buffer) => {
      pending = Buffer.concat([pending, d]);
      while (pending.length >= FRAME_BYTES) {
        values.push(readStamp(pending.subarray(0, FRAME_BYTES)));
        pending = pending.subarray(FRAME_BYTES);
      }
    });
    child.stderr.on("data", () => {});
    child.once("close", (code) =>
      resolve(code === 0 && values.length > 0 ? values : null)
    );
    child.once("error", () => resolve(null));
  });

/** Each frame's burned-in clock and index, in file order. */
export const decodeStamps = async (file: string) =>
  (await decodeWith(file, true)) ?? (await decodeWith(file, false)) ?? [];

/** A clock value unwrapped to the full Windows ms nearest `near`. */
export const unwrap = (v: number, near: number) => {
  const d = (((v - near) % CLOCK_MOD) + CLOCK_MOD) % CLOCK_MOD;
  return near + (d > CLOCK_MOD / 2 ? d - CLOCK_MOD : d);
};

const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * How many of `n` samples the start and the end of a take are each read
 * over for drift: a minute's worth, but never more than a quarter, so the
 * two never overlap on a short take.
 */
export const driftWindow = (n: number, perMinute = n) =>
  Math.max(1, Math.min(perMinute, Math.floor(n / 4)));

export type PictureReport = {
  frames: number;
  /** Frames at the head that repeat the first real one (back to T0). */
  leadingRepeats: number;
  /** The first real frame's capture time, Windows ms. */
  firstCaptureMs: number;
  /** Frames there twice after the head (the same index again): the picture stood still. */
  repeated: number;
  /** Frames missing: indexes skipped. */
  dropped: number;
  /** Reads that fit neither neighbour (encode or decode noise), left out. */
  unreadable: number;
  /**
   * The source's own stalls, from the clock: frames' worth of jumps past 1.5
   * intervals, and the longest. Not a loss (every index is there); a starved
   * source makes its late frames back to back. On a real Cam Link a stall of
   * the capture sits in dshow's buffer.
   */
  sourceStalls: { frames: number; longestMs: number };
  /** How far behind file time the picture's capture time runs, ms: first and last minute (median). */
  lagStartMs: number;
  lagEndMs: number;
};

/** Each value unwrapped against the one before it, so a sequence never jumps by a wrap. */
const unwrapRun = (vs: number[], mod: number, start: number) => {
  const out: number[] = [];
  let at = start;
  let raw = ((start % mod) + mod) % mod;
  for (const v of vs) {
    const d = (((v - raw) % mod) + mod) % mod;
    at += d > mod / 2 ? d - mod : d;
    raw = v;
    out.push(at);
  }
  return out;
};

/**
 * Which reads are noise: a read far from both neighbours, which agree with
 * each other (they span at most `maxSpan`).
 */
const misreads = (xs: number[], maxSpan: number, slack: number) => {
  const bad = xs.map(() => false);
  for (let n = 1; n < xs.length - 1; n++) {
    const prev = xs[n - 1]!;
    const next = xs[n + 1]!;
    const here = xs[n]!;
    const span = next - prev;
    const fits = here >= prev - slack && here <= next + slack;
    if (!fits && span >= 0 && span <= maxSpan) bad[n] = true;
  }
  return bad;
};

/**
 * What a picture file's stamps say. `fps` is the file's CFR rate, `t0Ms` the
 * Recording Session's T0 on the Windows clock.
 *
 * Repeats and drops come from the frame index alone: each frame says which
 * it is. The clock says when each was made, for the first frame, the lag
 * and the source's stalls.
 */
export const analysePicture = (
  stamps: FrameStamp[],
  o: { fps: number; t0Ms: number }
): PictureReport => {
  const interval = 1000 / o.fps;
  const clock = stamps.map((s) => unwrap(s.clock, o.t0Ms));
  const index = unwrapRun(
    stamps.map((s) => s.index),
    INDEX_MOD,
    stamps[0]?.index ?? 0
  );
  const badClock = misreads(clock, 3 * interval, 1);
  const badIndex = misreads(index, 3, 0);
  const bad = stamps.map((_, n) => badClock[n]! || badIndex[n]!);
  const unreadable = bad.filter(Boolean).length;
  const good = stamps.map((_, n) => n).filter((n) => !bad[n]);

  let lead = 0;
  while (lead + 1 < good.length && index[good[lead + 1]!] === index[good[0]!])
    lead++;
  let repeated = 0;
  let dropped = 0;
  let stallFrames = 0;
  let longestMs = 0;
  for (let g = 1; g < good.length; g++) {
    const n = good[g]!;
    const p = good[g - 1]!;
    const between = n - p - 1;
    const dc = clock[n]! - clock[p]!;
    if (between === 0) {
      longestMs = Math.max(longestMs, dc);
      if (dc > 1.5 * interval) stallFrames += Math.round(dc / interval) - 1;
    }
    if (g <= lead) continue;
    // Misread frames between the two stood for some of the gap.
    const missing = index[n]! - index[p]! - 1 - between;
    if (missing > 0) dropped += missing;
    else if (missing < 0) repeated += -missing;
  }
  const lagAt = (n: number) => o.t0Ms + (n * 1000) / o.fps - clock[n]!;
  const tail = good.slice(lead + 1);
  const span = driftWindow(tail.length, Math.round(60 * o.fps));
  return {
    frames: stamps.length,
    leadingRepeats: lead,
    firstCaptureMs: good.length ? clock[good[0]!]! : NaN,
    repeated,
    dropped,
    unreadable,
    sourceStalls: { frames: stallFrames, longestMs },
    lagStartMs: median(tail.slice(0, span).map(lagAt)),
    lagEndMs: median(tail.slice(-span).map(lagAt)),
  };
};

const ffmpegLog = (args: string[]) =>
  spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).stderr;

export type MicReport = {
  /** File time of the first non-silent sample (s): before it, aresample's padding. */
  firstSoundSeconds: number;
  /** File times of each burst's onset (s). */
  onsets: number[];
  /** How far the bursts moved against their own period, ms: first and last minute (median). */
  driftStartMs: number;
  driftEndMs: number;
};

export const analyseMic = (file: string): MicReport => {
  const first = ffmpegLog([
    "-i",
    file,
    "-af",
    "silencedetect=n=-70dB:d=0.002",
    "-f",
    "null",
    "-",
  ]);
  const starts = [...first.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) =>
    Number(m[1])
  );
  const ends = [...first.matchAll(/silence_end: (-?[\d.]+)/g)].map((m) =>
    Number(m[1])
  );
  const firstSoundSeconds =
    starts.length > 0 && starts[0]! <= 0.001 ? (ends[0] ?? NaN) : 0;
  const bursts = ffmpegLog([
    "-i",
    file,
    "-af",
    "silencedetect=n=-20dB:d=0.5",
    "-f",
    "null",
    "-",
  ]);
  const onsets = [...bursts.matchAll(/silence_end: (-?[\d.]+)/g)].map((m) =>
    Number(m[1])
  );
  const a0 = onsets[0] ?? 0;
  const residual = (a: number) =>
    (a -
      a0 -
      BURST_PERIOD_SECONDS * Math.round((a - a0) / BURST_PERIOD_SECONDS)) *
    1000;
  const span = driftWindow(onsets.length, Math.ceil(60 / BURST_PERIOD_SECONDS));
  return {
    firstSoundSeconds,
    onsets,
    driftStartMs: median(onsets.slice(0, span).map(residual)),
    driftEndMs: median(onsets.slice(-span).map(residual)),
  };
};

export type Playable = {
  exists: boolean;
  durationSeconds: number | null;
  decodeErrors: number;
};

/** Whether a file opens with a duration and decodes without errors. */
export const playable = (file: string): Playable => {
  if (!fs.existsSync(file))
    return { exists: false, durationSeconds: null, decodeErrors: 0 };
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" }
  );
  const duration = Number(probe.stdout.trim());
  const decode = ffmpegLog(["-v", "error", "-i", file, "-f", "null", "-"]);
  return {
    exists: true,
    durationSeconds:
      Number.isFinite(duration) && duration > 0 ? duration : null,
    decodeErrors: decode.split("\n").filter((l) => l.trim()).length,
  };
};

export const isPlayable = (p: Playable) =>
  p.exists && p.durationSeconds !== null && p.decodeErrors === 0;
