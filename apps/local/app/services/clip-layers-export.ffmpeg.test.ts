import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VIDEO_FORMAT_DIMENSIONS } from "@cvm/core/features/videos/video-format";
import type { ClipLayerRow } from "@cvm/core/features/videos/clip-layer";
import {
  clipComposite,
  clipFfmpegInput,
  clipLayers,
  clipSource,
  type ClipSourceRow,
} from "@/packages/clip-source";
import { clipSegmentArgs } from "./clip-segment-args";

/**
 * A Clip's Footage Layers as the export draws them: one segment rendered by
 * the real ffmpeg from lavfi stand-ins for a Landscape stream session (a red
 * screen with a blue right half, a lime camera) and an Imported Footage file
 * (yellow, with a 1 kHz tone). Probed by colour and by loudness.
 */
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

const dir = path.join(os.tmpdir(), `clip-layers-${process.pid}-${Date.now()}`);
const file = (name: string) => path.join(dir, name);

const lavfi = (name: string, inputs: string[], codec: string[]) =>
  execFileSync("ffmpeg", ["-v", "error", ...inputs, ...codec, file(name)]);

const footageRow = (
  position: number,
  o: Partial<ClipLayerRow> &
    Pick<ClipLayerRow, "cropX" | "cropY" | "cropW" | "cropH"> &
    Pick<ClipLayerRow, "placeX" | "placeY" | "placeW" | "placeH">
): ClipLayerRow => ({
  position,
  kind: "footage",
  footagePath: null,
  footageStart: null,
  sessionFile: null,
  volume: 0,
  spanAt: null,
  spanDuration: null,
  ...o,
});

const sceneRow = (position: number, volume = 1): ClipLayerRow => ({
  ...footageRow(position, {
    cropX: null,
    cropY: null,
    cropW: null,
    cropH: null,
    placeX: null,
    placeY: null,
    placeW: null,
    placeH: null,
  }),
  kind: "scene",
  volume,
});

const sessionClip = (layers: ClipLayerRow[], mic = "mic.wav") => ({
  videoFilename: file(mic),
  sourceStartTime: 0.5,
  sourceEndTime: 1.5,
  recordingSessionId: "session-1",
  sceneOverride: null,
  layers,
  recordingSession: {
    id: "session-1",
    screenFilePath: file("screen.mkv"),
    cameraFilePath: file("camera.mkv"),
    micFilePath: file(mic),
    micOffsetMs: 0,
    format: "landscape" as const,
    screenCaptured: true,
    sceneEvents: [{ fileTime: 0, scene: "Camera" as const }],
  },
});

/** Render the Clip as one export segment of `format`; its file. */
const render = (row: ClipSourceRow, format: "short" | "landscape") => {
  const source = clipSource(row);
  const input = clipFfmpegInput(source);
  const out = file(`${Math.random().toString(36).slice(2)}.mov`);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    ...clipSegmentArgs(
      {
        ...input,
        zoomType: "none",
        composite: clipComposite(source),
        layers: clipLayers(source),
      },
      VIDEO_FORMAT_DIMENSIONS[format],
      out
    ),
  ]);
  return out;
};

const size = (out: string) =>
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      out,
    ],
    { encoding: "utf8" }
  ).trim();

/** The rgb of the pixel at (x, y) of the frame at `t`. */
const pixel = (out: string, t: number, x: number, y: number) => [
  ...execFileSync("ffmpeg", [
    "-v",
    "error",
    "-ss",
    String(t),
    "-i",
    out,
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

const RED = [255, 0, 0];
const LIME = [0, 255, 0];
const YELLOW = [255, 255, 0];

/** The loudest sample, dBFS. */
const maxVolume = (out: string) => {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", out, "-af", "volumedetect", "-f", "null", "-"],
    { encoding: "utf8" }
  );
  return Number(
    /max_volume: (-?[\d.]+|-inf) dB/.exec(result.stderr)?.[1] ?? -Infinity
  );
};

describe.skipIf(!hasFfmpeg)("a Clip's Footage Layers in the export", () => {
  beforeAll(() => {
    fs.mkdirSync(dir, { recursive: true });
    const h264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
    lavfi(
      "screen.mkv",
      [
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=320x180:r=60:d=3,drawbox=x=160:y=0:w=160:h=180:c=blue:t=fill",
      ],
      h264
    );
    lavfi(
      "camera.mkv",
      ["-f", "lavfi", "-i", "color=c=lime:s=384x216:r=30000/1001:d=3"],
      h264
    );
    lavfi("mic.wav", ["-f", "lavfi", "-i", "sine=f=440:r=48000:d=3"], []);
    lavfi(
      "silent-mic.wav",
      ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono:d=3"],
      ["-t", "3"]
    );
    lavfi(
      "imported.mkv",
      [
        "-f",
        "lavfi",
        "-i",
        "color=c=yellow:s=320x240:r=30:d=3",
        "-f",
        "lavfi",
        "-i",
        "sine=f=1000:r=48000:d=3",
      ],
      [...h264, "-c:a", "pcm_s16le"]
    );
  }, 60_000);

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("draws a stream Clip on a Short as the screen's square on top and the camera band below, with no Scene Layer", () => {
    const out = render(
      sessionClip([
        footageRow(0, {
          sessionFile: "screen",
          cropX: 0,
          cropY: 0,
          cropW: 0.5,
          cropH: 1,
          placeX: 0,
          placeY: 0,
          placeW: 1080,
          placeH: 1080,
        }),
        footageRow(1, {
          sessionFile: "camera",
          cropX: 0,
          cropY: 0,
          cropW: 1,
          cropH: 1,
          placeX: 0,
          placeY: 1080,
          placeW: 1080,
          placeH: 840,
        }),
      ]),
      "short"
    );
    expect(size(out)).toBe("1080,1920");
    // The square is the screen's left half only: red, never its blue half.
    expect(near(pixel(out, 0.5, 100, 540), RED)).toBe(true);
    expect(near(pixel(out, 0.5, 1000, 540), RED)).toBe(true);
    expect(near(pixel(out, 0.5, 540, 1500), LIME)).toBe(true);
  });

  it("draws a Footage Layer above the Scene Layer of a Landscape Clip, only within its span", () => {
    const out = render(
      sessionClip([
        sceneRow(0),
        footageRow(1, {
          footagePath: file("imported.mkv"),
          footageStart: 1,
          cropX: 0,
          cropY: 0,
          cropW: 1,
          cropH: 1,
          placeX: 100,
          placeY: 100,
          placeW: 400,
          placeH: 300,
          spanAt: 0.5,
          spanDuration: 0.3,
        }),
      ]),
      "landscape"
    );
    expect(size(out)).toBe("1920,1080");
    expect(near(pixel(out, 0.2, 300, 250), LIME)).toBe(true);
    expect(near(pixel(out, 0.6, 300, 250), YELLOW)).toBe(true);
    expect(near(pixel(out, 0.6, 960, 540), LIME)).toBe(true);
    expect(near(pixel(out, 0.9, 300, 250), LIME)).toBe(true);
  });

  it("draws a Landscape Clip with Footage Layers only on black, keeping the Clip's own sound", () => {
    const out = render(
      sessionClip([
        footageRow(0, {
          sessionFile: "screen",
          cropX: 0,
          cropY: 0,
          cropW: 0.5,
          cropH: 1,
          placeX: 0,
          placeY: 0,
          placeW: 960,
          placeH: 1080,
        }),
        footageRow(1, {
          sessionFile: "camera",
          cropX: 0,
          cropY: 0,
          cropW: 1,
          cropH: 1,
          placeX: 1280,
          placeY: 720,
          placeW: 640,
          placeH: 360,
        }),
      ]),
      "landscape"
    );
    expect(size(out)).toBe("1920,1080");
    expect(near(pixel(out, 0.5, 480, 540), RED)).toBe(true);
    expect(near(pixel(out, 0.5, 1600, 900), LIME)).toBe(true);
    // Nothing is placed over the top right: the black base shows.
    expect(near(pixel(out, 0.5, 1600, 200), [0, 0, 0])).toBe(true);
    expect(maxVolume(out)).toBeCloseTo(
      maxVolume(render(sessionClip([]), "landscape")),
      0
    );
  });

  const withImported = (volume: number | undefined, mic: string) =>
    render(
      sessionClip(
        [
          sceneRow(0),
          footageRow(1, {
            footagePath: file("imported.mkv"),
            footageStart: 0,
            cropX: 0,
            cropY: 0,
            cropW: 1,
            cropH: 1,
            placeX: 0,
            placeY: 0,
            placeW: 320,
            placeH: 240,
            ...(volume === undefined ? {} : { volume }),
          }),
        ],
        mic
      ),
      "landscape"
    );

  it("mutes an added Footage Layer by default, and plays it at a set volume", () => {
    expect(maxVolume(withImported(undefined, "silent-mic.wav"))).toBeLessThan(
      -80
    );
    expect(maxVolume(withImported(1, "silent-mic.wav"))).toBeGreaterThan(-25);
  });

  it("keeps the Clip's own sound at full under its Footage Layers", () => {
    const untouched = maxVolume(render(sessionClip([]), "landscape"));
    expect(untouched).toBeGreaterThan(-25);
    expect(maxVolume(withImported(undefined, "mic.wav"))).toBeCloseTo(
      untouched,
      0
    );
  });
});
