// Thin wrappers around the Windows ffmpeg.exe / ffprobe.exe used by the analysis.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { TONE } from "./sync.ts";
import { windowsTool } from "./win.ts";

export function ffmpeg(args: string[], cwd: string) {
  const r = spawnSync(
    windowsTool("ffmpeg"),
    ["-hide_banner", "-nostats", ...args],
    {
      cwd,
      maxBuffer: 1 << 30,
    }
  );
  return { stdout: r.stdout as Buffer, stderr: String(r.stderr) };
}

export function probe(file: string) {
  const r = spawnSync(
    windowsTool("ffprobe"),
    [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      path.basename(file),
    ],
    { cwd: path.dirname(file), encoding: "utf8", maxBuffer: 1 << 26 }
  );
  if (r.status !== 0) return null;
  return JSON.parse(r.stdout) as {
    format: { duration?: string; size?: string };
    streams: Record<string, string | number>[];
  };
}

export function lastPacketTime(file: string): number {
  const r = spawnSync(
    windowsTool("ffprobe"),
    [
      "-v",
      "error",
      "-select_streams",
      "0",
      "-show_entries",
      "packet=pts_time,duration_time",
      "-of",
      "csv=p=0",
      path.basename(file),
    ],
    { cwd: path.dirname(file), encoding: "utf8", maxBuffer: 1 << 28 }
  );
  let end = 0;
  for (const line of r.stdout.split("\n")) {
    const [pts, dur] = line.split(",").map(Number);
    if (Number.isFinite(pts))
      end = Math.max(end, pts! + (Number.isFinite(dur) ? dur! : 0));
  }
  return end;
}

export function countPackets(file: string): number {
  const r = spawnSync(
    windowsTool("ffprobe"),
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-count_packets",
      "-show_entries",
      "stream=nb_read_packets",
      "-of",
      "csv=p=0",
      path.basename(file),
    ],
    { cwd: path.dirname(file), encoding: "utf8" }
  );
  return Number(r.stdout.trim());
}

/** Mean luma of every frame in [from, from+dur), optionally inside a crop rect. */

/** Mean luma of every frame in [from, from+dur), optionally inside a crop rect. */
export function lumaSeries(
  file: string,
  from: number,
  dur: number,
  crop?: string
) {
  const vf = [crop ? `crop=${crop}` : "", "scale=16:9:flags=area", "showinfo"]
    .filter(Boolean)
    .join(",");
  const { stderr } = ffmpeg(
    [
      "-copyts",
      "-ss",
      String(Math.max(0, from)),
      "-t",
      String(dur),
      "-i",
      path.basename(file),
      "-vf",
      vf,
      "-an",
      "-f",
      "null",
      "-",
    ],
    path.dirname(file)
  );
  const t: number[] = [];
  const v: number[] = [];
  for (const m of stderr.matchAll(/pts_time:\s*([\d.]+).*?mean:\[(\d+)/g)) {
    t.push(Number(m[1]));
    v.push(Number(m[2]));
  }
  return { t, v };
}

/** The whole mic, mono at TONE.sr, as samples in [-1, 1). Sample i is at file time startTime + i / sr. */
export function micSamples(file: string): Float64Array {
  const { stdout } = ffmpeg(
    [
      "-i",
      path.basename(file),
      "-vn",
      "-ac",
      "1",
      "-ar",
      String(TONE.sr),
      "-f",
      "s16le",
      "-",
    ],
    path.dirname(file)
  );
  const n = stdout.length >> 1;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = stdout.readInt16LE(i * 2) / 32768;
  return x;
}
