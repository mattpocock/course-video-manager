import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { copyMkvSpan } from "./mkv-span";
import { spanCutArgs } from "./whisper-transcription-service";

/**
 * A Clip's span of a growing mic.mkv (#2224), read through the real ffmpeg
 * over a synthetic mic: 192 kbps AAC in Matroska with the recorder's
 * 1-second Clusters, cut short before its Cues as a take still recording is.
 * Skipped where there is no ffmpeg.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const dir = fs.mkdtempSync(path.join(tmpdir(), "mkv-span-test-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const ffmpeg = (...args: string[]) =>
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);

/** 10 minutes of a tone whose pitch keeps changing, so any shift shows. */
const makeMic = () => {
  const finished = path.join(dir, "finished.mkv");
  ffmpeg(
    "-f",
    "lavfi",
    "-i",
    "aevalsrc='0.5*sin(2*PI*300*t+600*cos(t/3))*(0.6+0.4*sin(2*PI*1.3*t))':s=48000:d=600",
    ...["-c:a", "aac", "-b:a", "192k", "-ar", "48000"],
    ...["-cluster_time_limit", "1000", "-f", "matroska"],
    finished
  );
  // Still recording: the Cues (and the end of the last Cluster) not written.
  const growing = path.join(dir, "growing.mkv");
  const bytes = fs.readFileSync(finished);
  fs.writeFileSync(growing, bytes.subarray(0, bytes.length - 100_000));
  return { finished, growing };
};

/** Decodes ffmpeg's output args to mono 16 kHz samples. */
const samples = (args: string[]) => {
  const out = execFileSync("ffmpeg", [
    "-v",
    "error",
    ...args,
    ...["-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
  ]);
  return new Int16Array(out.buffer, out.byteOffset, out.length / 2);
};

describe.skipIf(!hasFfmpeg)("copyMkvSpan", () => {
  const { finished, growing } = makeMic();
  const range = { startTime: 540.25, duration: 6.5 };

  it("copies only the Clip's Clusters out of a growing mic file, and ffmpeg hears exactly the Clip", async () => {
    const span = path.join(dir, "span.mkv");
    const copied = await copyMkvSpan(
      growing,
      span,
      range.startTime,
      range.startTime + range.duration
    );
    // The AAC encoder's priming: ffmpeg's start_time, which -ss counts from.
    expect(copied?.startSeconds).toBe(-0.021);

    // A few seconds of audio, not the 9 minutes before it.
    expect(fs.statSync(span).size).toBeLessThan(fs.statSync(growing).size / 30);

    // The very samples -ss/-t give on the whole, finished file.
    const viaSpan = samples(spanCutArgs(span, range, copied!.startSeconds));
    const viaWhole = samples([
      "-ss",
      String(range.startTime),
      "-t",
      String(range.duration),
      "-i",
      finished,
    ]);
    expect(viaSpan.length).toBe(viaWhole.length);
    let diff = 0;
    let energy = 0;
    const n = Math.min(viaSpan.length, viaWhole.length);
    for (let i = 0; i < n; i++) {
      diff += (viaSpan[i]! - viaWhole[i]!) ** 2;
      energy += viaWhole[i]! ** 2;
    }
    expect(diff / energy).toBeLessThan(0.001);
  });

  it("reads a Clip from the very start of the file", async () => {
    const span = path.join(dir, "start.mkv");
    const copied = await copyMkvSpan(growing, span, 0, 3);
    expect(
      samples(
        spanCutArgs(span, { startTime: 0, duration: 3 }, copied!.startSeconds)
      ).length
    ).toBeCloseTo(16_000 * 3, -1);
  });

  it("refuses a file that is not Matroska, so it is read whole", async () => {
    const mp3 = path.join(dir, "not.mp3");
    ffmpeg("-f", "lavfi", "-i", "sine=d=2", mp3);
    expect(await copyMkvSpan(mp3, path.join(dir, "no.mkv"), 0, 1)).toBeNull();
  });
});
