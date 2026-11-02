import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { CAMERA_CFR } from "./capture-args";

/**
 * camera.mkv's CFR 29.97 (`CAMERA_CFR`) in the real ffmpeg, over a camera
 * that never drops or repeats a frame (#2442). Its stamps reach the writer
 * through the Matroska relay, which rounds each to the millisecond. When T0
 * puts the frames about half a frame off camera.mkv's ticks, that rounding
 * sends one frame to the tick before and the next to the tick after: a
 * frame dropped and one repeated, a third of the take. Each frame carries
 * its index in its pixel value, read back from the output. Skipped where
 * there is no ffmpeg.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Windows wall time of T0, in seconds. */
const T0 = 100;
const FRAMES = 900;

/**
 * Frames dropped and repeated in the camera's CFR output when its first
 * frame comes `phaseMs` after T0, every stamp rounded to the millisecond as
 * the writer relay rounds it.
 */
const dropsAndRepeats = (phaseMs: number) => {
  const raw = execFileSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-v",
      "error",
      "-copyts",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=16x2:r=30000/1001,format=gray,geq=lum='mod(N\\,256)'," +
        `settb=AVTB,setpts=PTS+(${T0}+${phaseMs / 1000})/TB,` +
        "setpts='round(T*1000)/1000/TB'",
      "-frames:v",
      String(FRAMES),
      "-filter_complex",
      `[0:v]setpts=PTS-${T0}/TB,${CAMERA_CFR},crop=16:1:0:0[cam]`,
      "-map",
      "[cam]",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "gray",
      "-",
    ],
    { maxBuffer: 1 << 24 }
  );
  let dropped = 0;
  let repeated = 0;
  for (let at = 16; at < raw.length; at += 16) {
    const step = (raw[at]! - raw[at - 16]! + 256) % 256;
    if (step === 0) repeated++;
    else dropped += step - 1;
  }
  return { phaseMs, dropped, repeated };
};

describe.skipIf(!hasFfmpeg)("camera.mkv's CFR in ffmpeg", () => {
  it("drops and repeats nothing, wherever T0 falls against the camera's frames", () => {
    // Every 1 ms across one frame interval, and finely around half a frame,
    // where millisecond stamps straddle camera.mkv's tick boundary.
    const phases = [
      ...Array.from({ length: 34 }, (_, ms) => ms),
      16.2,
      16.4,
      16.6,
      16.8,
      17.0,
    ];
    for (const phaseMs of phases) {
      const r = dropsAndRepeats(phaseMs);
      // The leading frame repeated back to T0 is the only repeat allowed.
      expect({ ...r, repeated: Math.max(0, r.repeated - 1) }).toEqual({
        phaseMs,
        dropped: 0,
        repeated: 0,
      });
    }
  }, 60_000);
});
