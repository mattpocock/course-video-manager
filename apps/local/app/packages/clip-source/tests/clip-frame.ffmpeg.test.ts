import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clipFrame,
  clipFrameFfmpegArgs,
  clipSource,
  type ClipFrame,
} from "@/packages/clip-source";

/**
 * Renders a new-recorder Clip's first and last frames with the real ffmpeg
 * from tiny lavfi stand-ins for a Recording Session's files (no device): a
 * red 60 fps screen and a green 29.97 fps camera, two seconds each, and
 * reads known pixels back. Skipped where there is no ffmpeg.
 */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const W = 1920;
const H = 1080;

describe.skipIf(!hasFfmpeg)("a new-recorder Clip's stills in ffmpeg", () => {
  // Made in beforeAll: a skipped describe still runs its body.
  const dir = path.join(tmpdir(), `clip-frame-${process.pid}-${Date.now()}`);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const file = (name: string, lavfi: string) => {
    const out = path.join(dir, name);
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      lavfi,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      out,
    ]);
    return out;
  };
  const screen = path.join(dir, "screen.mkv");
  const camera = path.join(dir, "camera.mkv");
  beforeAll(() => {
    mkdirSync(dir, { recursive: true });
    file("screen.mkv", "color=c=red:s=320x180:r=60:d=2");
    file("camera.mkv", "color=c=lime:s=384x216:r=30000/1001:d=2");
  });

  // Code until 1 s, then Camera: the first frame is the screen with the face
  // cam bottom right, the last is the camera full frame.
  const source = clipSource({
    videoFilename: path.join(dir, "mic.mkv"),
    sourceStartTime: 0.5,
    sourceEndTime: 1.8,
    recordingSession: {
      id: "session-1",
      cameraFilePath: camera,
      screenFilePath: screen,
      micFilePath: path.join(dir, "mic.mkv"),
      micOffsetMs: 150,
      sceneEvents: [{ fileTime: 1, scene: "Camera" }],
    },
  });

  const render = (frame: ClipFrame) =>
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-v",
        "error",
        ...clipFrameFfmpegArgs(frame, { seek: frame.time.toFixed(2) }),
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
      ],
      { maxBuffer: 1 << 28 }
    );

  const pixel = (frame: Buffer, x: number, y: number) => {
    const o = (y * W + x) * 3;
    return [frame[o]!, frame[o + 1]!, frame[o + 2]!];
  };
  const near = (actual: number[], expected: number[]) =>
    actual.every((v, i) => Math.abs(v - expected[i]!) <= 24);

  it("draws the first frame in the scene the Clip starts in", () => {
    const frame = render(clipFrame(source, "first"));
    expect(frame.length).toBe(W * H * 3);
    expect(near(pixel(frame, 100, 100), [255, 0, 0])).toBe(true);
    expect(near(pixel(frame, 1700, 800), [0, 255, 0])).toBe(true);
  });

  it("draws the last frame in the scene the Clip ends in", () => {
    const frame = render(clipFrame(source, "last"));
    expect(near(pixel(frame, 100, 100), [0, 255, 0])).toBe(true);
    expect(near(pixel(frame, 0, 0), [0, 0, 0])).toBe(true);
  });
});
