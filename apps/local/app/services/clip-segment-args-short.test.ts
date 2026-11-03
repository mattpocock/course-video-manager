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

/** An untouched Clip's Layers: one Scene Layer. */
const UNTOUCHED = [{ kind: "scene" as const, volume: 1 }];

const shortClip = (
  dir: string,
  o: {
    scene: Scene;
    screenCaptured: boolean;
    /** The Recording Session's own format; the Video is a Short. */
    sessionFormat?: "landscape" | "short";
  }
) => {
  const source = clipSource(
    {
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
        format: o.sessionFormat ?? "short",
        screenCaptured: o.screenCaptured,
        sceneEvents: [{ fileTime: 0, scene: o.scene }],
      },
    },
    { videoFormat: "short" }
  );
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

  it("draws a Landscape session's Clip in the Short layout, not its own squashed", () => {
    const args = clipSegmentArgs(
      shortClip(dir, {
        scene: "Code",
        screenCaptured: true,
        sessionFormat: "landscape",
      }),
      SHORT,
      "/out/0.mov"
    );
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("color=c=black:s=1080x1920");
    expect(graph).toContain("crop=w=min(iw\\,ih)");
    expect(graph).not.toContain("1920x1080");
  });

  it("covers the Short's frame with a single 16:9 file, centre-cropped", () => {
    const args = clipSegmentArgs(
      {
        inputVideo: "/obs/a.mkv",
        startTime: 0,
        duration: 1,
        composite: null,
        layers: UNTOUCHED,
      },
      SHORT,
      "/out/0.mov"
    );
    const graph = args[args.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain(
      "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,"
    );
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
  { name: "1080x1080, drawn whole", width: 1080, sessionFormat: "short" },
  { name: "1920x1080, its left square", width: 1920, sessionFormat: "short" },
  // A stream's Clip: a Landscape session's DELL screen, on a Short.
  {
    name: "of a Landscape session, its left square",
    width: 1920,
    sessionFormat: "landscape",
  },
] as const;

describe.skipIf(!hasFfmpeg).each(SPACEDESK_SCREENS)(
  "rendering a Short Code segment in ffmpeg, the screen $name",
  ({ width, sessionFormat }) => {
    const dir = path.join(
      os.tmpdir(),
      `short-segment-${width}-${sessionFormat}-${process.pid}-${Date.now()}`
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
          shortClip(dir, {
            scene: "Code",
            screenCaptured: true,
            sessionFormat,
          }),
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

/**
 * A single 16:9 file (an OBS or Imported Footage Clip) on a Short: red with a
 * white 100 px square at its centre. Covering the 1080x1920 frame scales it
 * by 1920/1080 and keeps its middle, so the square lands 178 px wide at the
 * centre; stretched, it would be 56 px wide.
 */
describe.skipIf(!hasFfmpeg)("rendering a 16:9 Footage Clip on a Short", () => {
  const dir = path.join(
    os.tmpdir(),
    `short-footage-${process.pid}-${Date.now()}`
  );
  const out = path.join(dir, "segment.mov");

  beforeAll(() => {
    fs.mkdirSync(dir, { recursive: true });
    // prettier-ignore
    execFileSync("ffmpeg", [
      "-v", "error",
      "-f", "lavfi", "-i",
      "color=c=red:s=1920x1080:r=30:d=2," +
        "drawbox=x=910:y=490:w=100:h=100:color=white:t=fill",
      "-f", "lavfi", "-i", "sine=f=440:r=48000:d=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
      path.join(dir, "footage.mkv"),
    ]);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      ...clipSegmentArgs(
        {
          inputVideo: path.join(dir, "footage.mkv"),
          startTime: 0.5,
          duration: 1,
          composite: null,
          layers: UNTOUCHED,
        },
        SHORT,
        out
      ),
    ]);
  }, 60_000);

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is 1080x1920, covered and centre-cropped, not stretched", () => {
    const WHITE = [255, 255, 255];
    const RED = [255, 0, 0];
    expect(near(pixel(out, 540, 960), WHITE)).toBe(true);
    // As wide as it is tall: 178 px each way.
    for (const [x, y] of [
      [470, 960],
      [610, 960],
      [540, 890],
      [540, 1030],
    ])
      expect(near(pixel(out, x!, y!), WHITE)).toBe(true);
    for (const [x, y] of [
      [430, 960],
      [650, 960],
      [4, 4],
      [1076, 1916],
    ])
      expect(near(pixel(out, x!, y!), RED)).toBe(true);
  });
});
