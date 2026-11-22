import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CALIBRATION_MIC_FILE,
  calibrationAnalysisArgs,
  parseCalibrationAnalysis,
} from "./calibration-run";

/**
 * The calibration's analysis in the real ffmpeg, over synthetic mic files
 * (no device): a faint hum, a -27 dBFS tone in each speech window, and a
 * clap in the clap window, at full scale or not at all. The clap must count
 * towards neither the speech loudness nor the true peak. Skipped where there
 * is no ffmpeg.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const SILENCE = { startSeconds: 0.5, endSeconds: 2.5 };
const CLAPS = { startSeconds: 3, endSeconds: 5 };
const SPEECH = [
  { startSeconds: 5.5, endSeconds: 7.5 },
  { startSeconds: 8, endSeconds: 10 },
];

describe.skipIf(!hasFfmpeg)("the calibration's analysis in ffmpeg", () => {
  const root = path.join(
    tmpdir(),
    `calibration-run-${process.pid}-${Date.now()}`
  );
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const measure = (clapAmplitude: number) => {
    const dir = path.join(root, String(clapAmplitude));
    mkdirSync(dir, { recursive: true });
    const speech = SPEECH.map(
      (w) => `between(t\\,${w.startSeconds}\\,${w.endSeconds})*0.0447`
    ).join("+");
    const expr = `(${speech})*sin(2*PI*440*t)+between(t\\,4\\,4.02)*${clapAmplitude}*sin(2*PI*2000*t)+0.0003*sin(2*PI*50*t)`;
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `aevalsrc=${expr}|${expr}:s=48000:d=11`,
      "-c:a",
      "pcm_s16le",
      path.join(dir, CALIBRATION_MIC_FILE),
    ]);
    const { status, stderr } = spawnSync(
      "ffmpeg",
      calibrationAnalysisArgs({
        silence: SILENCE,
        speech: SPEECH,
        claps: CLAPS,
      }),
      { cwd: dir, encoding: "utf8" }
    );
    expect(status).toBe(0);
    return parseCalibrationAnalysis(stderr)!;
  };

  it("leaves the clap window out of the speech loudness and the true peak", () => {
    const quiet = measure(0);
    const clapped = measure(0.99);
    // The tone peaks at -27 dBFS; the clap, at about 0, is not counted.
    expect(quiet.truePeakDb).toBeLessThan(-20);
    expect(clapped.truePeakDb).toBeCloseTo(quiet.truePeakDb, 1);
    expect(clapped.speechLufs).toBeCloseTo(quiet.speechLufs, 1);
    expect(clapped.noiseFloorDb).toBeCloseTo(quiet.noiseFloorDb, 1);
  });
});
