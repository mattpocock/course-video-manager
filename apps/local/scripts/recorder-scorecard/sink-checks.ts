import { spawnSync } from "node:child_process";
import fs from "node:fs";

/**
 * WHAT YOUTUBE GOT, READ OFF THE SINKS' COPIES (#2502): on Matt's real take
 * the stream's sound stopped and its camera froze 30 s in, while it went on
 * encoding 60 fps. So each `sink-<n>.flv` is read back (Linux ffprobe and
 * ffmpeg, no GPU) for its sound's longest gap, sound that ends before the
 * picture, and the camera standing still.
 *
 * A sink that a fault ended (all but the last that got frames) ends however
 * the fault left it: its last `FAULT_TAIL_S` are left out.
 */

/** What is left out of a sink a fault ended: the fault, and the reconnect it waited for. */
const FAULT_TAIL_S = 20;

/**
 * The camera's place on the picture in the Code scene (1429,364 to the
 * canvas's corner): the camera's in the Camera scene too, the screen's in
 * No Face. The synthetic camera's clock blocks there change every frame.
 */
const CAMERA_REGION = { x: 1430, y: 364, w: 490, h: 716 };

/** Samples a second the camera's region is read at. */
const SAMPLE_FPS = 10;

/** A sample's mean change from the one before (0-255) under which it stood still: encoder noise only. */
const STILL_DIFF = 2;

const SAMPLE_SIDE = 16;

const packetTimes = (file: string, stream: "a" | "v") => {
  const r = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      `${stream}:0`,
      "-show_entries",
      "packet=pts_time",
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
  );
  return r.stdout
    .split("\n")
    .map((l) => Number.parseFloat(l))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
};

/** The camera region's longest stretch standing still (s), from `from` to `to` in the file's time. */
const longestStill = (file: string, from: number, to: number) => {
  if (to <= from) return 0;
  const r = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-loglevel",
      "error",
      "-ss",
      from.toFixed(3),
      "-i",
      file,
      "-t",
      (to - from).toFixed(3),
      "-vf",
      `fps=${SAMPLE_FPS},crop=${CAMERA_REGION.w}:${CAMERA_REGION.h}:${CAMERA_REGION.x}:${CAMERA_REGION.y},scale=${SAMPLE_SIDE}:${SAMPLE_SIDE},format=gray`,
      "-f",
      "rawvideo",
      "-",
    ],
    { maxBuffer: 256 * 1024 * 1024 }
  );
  const size = SAMPLE_SIDE * SAMPLE_SIDE;
  const frames = Math.floor(r.stdout.length / size);
  let run = 0;
  let longest = 0;
  for (let i = 1; i < frames; i++) {
    let diff = 0;
    for (let k = 0; k < size; k++)
      diff += Math.abs(r.stdout[i * size + k]! - r.stdout[(i - 1) * size + k]!);
    run = diff / size < STILL_DIFF ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return longest / SAMPLE_FPS;
};

export type SinkReport = {
  file: string;
  videoSeconds: [number, number] | null;
  audioSeconds: [number, number] | null;
  /** Up to where it was read: a fault's tail left out. */
  readUntil: number | null;
  /** The longest gap between sound packets, or the sound's end short of the picture's (ms). */
  audioGapMaxMs: number | null;
  cameraStillMaxS: number | null;
};

/** One sink's copy, read up to where a fault may have ended it. */
const readSink = (file: string, faultEnded: boolean): SinkReport => {
  const video = packetTimes(file, "v");
  const audio = packetTimes(file, "a");
  const empty = {
    file,
    videoSeconds: null,
    audioSeconds: null,
    readUntil: null,
    audioGapMaxMs: null,
    cameraStillMaxS: null,
  };
  if (video.length === 0) return empty;
  const start = video[0]!;
  const end = video.at(-1)!;
  const until = faultEnded ? end - FAULT_TAIL_S : end;
  if (until <= start) return { ...empty, videoSeconds: [start, end] };
  const heard = audio.filter((t) => t <= until);
  // No sound at all is a gap as long as the picture.
  let gap = heard.length === 0 ? until - start : 0;
  for (let i = 1; i < heard.length; i++)
    gap = Math.max(gap, heard[i]! - heard[i - 1]!);
  if (heard.length > 0) gap = Math.max(gap, until - heard.at(-1)!);
  return {
    file,
    videoSeconds: [start, end],
    audioSeconds: audio.length ? [audio[0]!, audio.at(-1)!] : null,
    readUntil: until,
    audioGapMaxMs: Math.round(gap * 1000),
    cameraStillMaxS: longestStill(file, start, until),
  };
};

/** Every sink's copy, in order; the worst of each check over all of them. */
export const readSinks = (files: readonly string[]) => {
  const present = files.filter((f) => fs.existsSync(f));
  const withFrames = present.filter((f) => packetTimes(f, "v").length > 0);
  const last = withFrames.at(-1);
  const sinks = withFrames.map((f) => readSink(f, f !== last));
  const worst = (k: "audioGapMaxMs" | "cameraStillMaxS") => {
    const xs = sinks.map((s) => s[k]).filter((x) => x !== null);
    return xs.length ? Math.max(...xs) : null;
  };
  return {
    sinks,
    audioGapMaxMs: worst("audioGapMaxMs"),
    cameraStillMaxS: worst("cameraStillMaxS"),
  };
};
