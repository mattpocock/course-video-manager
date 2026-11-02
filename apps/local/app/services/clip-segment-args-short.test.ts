import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VIDEO_FORMAT_DIMENSIONS } from "@cvm/core/features/videos/video-format";
import { clipComposite, clipLayers, clipSource } from "@/packages/clip-source";
import type { Scene } from "@/packages/scene-layout";
import { clipSegmentArgs } from "./clip-segment-args";

/**
 * A CVM-recorder Short Clip as one export segment (what render-vertical joins):
 * drawn on the Short layout's 1080x1920 canvas, so the scale to the
 * 1080x1920 Short export stretches nothing, and opening only the files its
 * segments draw — a camera-only Short session has no screen file at all.
 */
const SHORT = VIDEO_FORMAT_DIMENSIONS.short;

const shortClip = (
  dir: string,
  o: { scene: Scene; screenCaptured: boolean }
) => {
  const source = clipSource({
    videoFilename: path.join(dir, "mic.mkv"),
    sourceStartTime: 0.5,
    sourceEndTime: 1.5,
    recordingSessionId: "session-1",
    sceneOverride: null,
    recordingSession: {
      id: "session-1",
      screenFilePath: path.join(dir, "screen.mkv"),
      cameraFilePath: path.join(dir, "camera.mkv"),
      micFilePath: path.join(dir, "mic.mkv"),
      micOffsetMs: 150,
      format: "short",
      screenCaptured: o.screenCaptured,
      sceneEvents: [{ fileTime: 0, scene: o.scene }],
    },
  });
  return {
    inputVideo: path.join(dir, "mic.mkv"),
    startTime: 0.5,
    duration: 1,
    composite: clipComposite(source),
    layers: clipLayers(source),
  };
};

const inputs = (args: string[]) =>
  args.flatMap((a, i) => (args[i - 1] === "-i" ? [a] : []));

describe("a Short CVM-recorder Clip's segment arguments", () => {
  const dir = "/rec/s1";

  it("opens only the camera and the mic for a camera-only session", () => {
    const args = clipSegmentArgs(
      shortClip(dir, { scene: "Camera", screenCaptured: false }),
      SHORT,
      "/out/0.mov"
    );
    expect(inputs(args)).toEqual([
      path.join(dir, "camera.mkv"),
      path.join(dir, "mic.mkv"),
    ]);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("[0:v]split=1");
    expect(graph).toContain("[1:a]");
    expect(graph).not.toContain("[2:a]");
  });

  it("draws a Code Clip on the 1080x1920 canvas and keeps that size", () => {
    const args = clipSegmentArgs(
      shortClip(dir, { scene: "Code", screenCaptured: true }),
      SHORT,
      "/out/0.mov"
    );
    expect(inputs(args)).toEqual([
      path.join(dir, "screen.mkv"),
      path.join(dir, "camera.mkv"),
      path.join(dir, "mic.mkv"),
    ]);
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("color=c=black:s=1080x1920");
    expect(graph).toContain("[composite]scale=1080:1920,");
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

const lavfi = (file: string, source: string, codec: string[]) =>
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    source,
    ...codec,
    file,
  ]);

/** The rgb of the pixel at (x, y) (even) of the segment's first frame. */
const pixel = (file: string, x: number, y: number) => [
  ...execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    `crop=2:2:${x}:${y},format=rgb24`,
    "-f",
    "rawvideo",
    "-",
  ]).subarray(0, 3),
];

const near = (rgb: number[], expected: number[]) =>
  rgb.every((v, i) => Math.abs(v - expected[i]!) <= 40);

/**
 * The Spacedesk display at the two sizes a Short accepts (ADR 0043): its left
 * 1080x1080 square red with a white 100 px marker at (900,100), and any strip
 * right of the square blue.
 */
const SPACEDESK_SCREENS = [
  { name: "1080x1080, drawn whole", width: 1080 },
  { name: "1920x1080, its left square", width: 1920 },
] as const;

describe.skipIf(!hasFfmpeg).each(SPACEDESK_SCREENS)(
  "rendering a Short Code segment in ffmpeg, the screen $name",
  ({ width }) => {
    const dir = path.join(
      os.tmpdir(),
      `short-segment-${width}-${process.pid}-${Date.now()}`
    );
    const out = path.join(dir, "segment.mov");

    beforeAll(() => {
      fs.mkdirSync(dir, { recursive: true });
      const h264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
      lavfi(
        path.join(dir, "screen.mkv"),
        `color=c=blue:s=${width}x1080:r=60:d=2,` +
          "drawbox=x=0:y=0:w=1080:h=1080:color=red:t=fill," +
          "drawbox=x=900:y=100:w=100:h=100:color=white:t=fill",
        h264
      );
      lavfi(
        path.join(dir, "camera.mkv"),
        "color=c=lime:s=384x216:r=30000/1001:d=2",
        h264
      );
      lavfi(path.join(dir, "mic.mkv"), "sine=f=440:r=48000:d=2", [
        "-c:a",
        "aac",
        "-ac",
        "1",
      ]);
      execFileSync("ffmpeg", [
        "-v",
        "error",
        ...clipSegmentArgs(
          shortClip(dir, { scene: "Code", screenCaptured: true }),
          SHORT,
          out
        ),
      ]);
    }, 60_000);

    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("is 1080x1920: the screen's left square 1:1 at 0..1080, the camera band below", () => {
      const video = JSON.parse(
        execFileSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_streams",
            "-select_streams",
            "v",
            "-of",
            "json",
            out,
          ],
          { encoding: "utf8" }
        )
      ).streams[0];
      expect(video).toMatchObject({ width: 1080, height: 1920 });
      const RED = [255, 0, 0];
      const WHITE = [255, 255, 255];
      // The square fills 0..1080 on both axes, and none of the blue strip shows.
      for (const [x, y] of [
        [4, 4],
        [540, 500],
        [1076, 500],
        [1076, 1074],
        [4, 1074],
      ])
        expect(near(pixel(out, x!, y!), RED)).toBe(true);
      // The marker is where it was, at its size: drawn 1:1, not stretched.
      expect(near(pixel(out, 950, 150), WHITE)).toBe(true);
      for (const [x, y] of [
        [890, 150],
        [1010, 150],
        [950, 90],
        [950, 210],
      ])
        expect(near(pixel(out, x!, y!), RED)).toBe(true);
      expect(near(pixel(out, 540, 1500), [0, 255, 0])).toBe(true);
    });
  }
);
