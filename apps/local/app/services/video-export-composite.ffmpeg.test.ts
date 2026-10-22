import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { FileSystem } from "@effect/platform";
import { ConfigProvider, Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clipComposite, clipSource } from "@/packages/clip-source";
import { sceneFilterGraph } from "@/packages/scene-layout";
import { DEFAULT_MIC_EQ } from "@cvm/core/features/videos/recorder";
import { micEqFilters } from "./clip-segment-args";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { FFmpegEncodeService } from "./ffmpeg-encode-commands";
import { SidecarContextTest } from "./sidecar-context";
import { makeVideoExportPasses } from "./video-export-passes";

/**
 * The export pass over a Video of CVM-recorder Clips, with the real ffmpeg on
 * tiny synthetic stand-ins for a Recording Session (lavfi colours and a sine;
 * no device): a red 60 fps screen, a green 29.97 fps camera, a mono mic.
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

const lavfi = (dir: string, name: string, source: string, codec: string[]) => {
  const file = path.join(dir, name);
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
  return file;
};

const probe = (file: string) =>
  JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      {
        encoding: "utf8",
      }
    )
  ) as {
    streams: Record<string, string | number>[];
    format: { duration: string };
  };

/** The rgb of the pixel at (x, y) (even) of the frame at `t`. */
const pixel = (file: string, t: number, x: number, y: number) => [
  ...execFileSync("ffmpeg", [
    "-v",
    "error",
    "-ss",
    String(t),
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

/** Run the export pass over `clips`; the output file and every command run. */
const exportClips = async (
  dir: string,
  clips: Parameters<
    ReturnType<typeof makeVideoExportPasses>["exportVideoClips"]
  >[0]["clips"]
) => {
  const commands: string[] = [];
  const program = Effect.gen(function* () {
    const passes = makeVideoExportPasses({
      ffmpegEncode: yield* FFmpegEncodeService,
      ffmpegCommands: yield* FFmpegCommandsService,
      effectFs: yield* FileSystem.FileSystem,
      videoEditorLogger: {
        log: (_videoId, event) =>
          Effect.sync(() => {
            if (event.type === "cli-output") commands.push(event.command);
          }),
      } as Parameters<typeof makeVideoExportPasses>[0]["videoEditorLogger"],
    });
    return yield* passes.exportVideoClips({
      videoId: "video-1",
      format: "landscape",
      clips,
    });
  });
  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(
        Layer.mergeAll(
          FFmpegEncodeService.Default,
          FFmpegCommandsService.Default,
          NodeContext.layer,
          SidecarContextTest
        ).pipe(
          Layer.provide(
            Layer.setConfigProvider(
              ConfigProvider.fromMap(new Map([["STORAGE_ROOTS", dir]]))
            )
          )
        )
      )
    )
  );
  return { output: result.outputPath, commands };
};

const sessionRow = (
  dir: string,
  start: number,
  end: number,
  // Code until 1.5 s, then Camera.
  sceneEvents = [{ fileTime: 1.5, scene: "Camera" as const }]
) => ({
  videoFilename: path.join(dir, "mic.mkv"),
  sourceStartTime: start,
  sourceEndTime: end,
  recordingSessionId: "session-1",
  sceneOverride: null,
  recordingSession: {
    id: "session-1",
    screenFilePath: path.join(dir, "screen.mkv"),
    cameraFilePath: path.join(dir, "camera.mkv"),
    micFilePath: path.join(dir, "mic.mkv"),
    micOffsetMs: 150,
    format: "landscape" as const,
    screenCaptured: true,
    sceneEvents,
  },
});

const exportClip = (row: ReturnType<typeof sessionRow>) => {
  const source = clipSource(row);
  return {
    inputVideo: row.videoFilename,
    startTime: row.sourceStartTime,
    duration: row.sourceEndTime - row.sourceStartTime,
    pauseType: "none" as const,
    zoomType: "none",
    composite: clipComposite(source),
  };
};

describe.skipIf(!hasFfmpeg)("exporting a Video of CVM-recorder Clips", () => {
  const dir = path.join(
    os.tmpdir(),
    `composite-export-${process.pid}-${Date.now()}`
  );
  let commands: string[];
  let output: string;
  // The first Clip changes scene inside it; the second is all Camera.
  const clips = [sessionRow(dir, 0.5, 2), sessionRow(dir, 2.5, 3.5)].map(
    exportClip
  );

  beforeAll(async () => {
    fs.mkdirSync(dir, { recursive: true });
    const h264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
    lavfi(dir, "screen.mkv", "color=c=red:s=320x180:r=60:d=4", h264);
    lavfi(dir, "camera.mkv", "color=c=lime:s=384x216:r=30000/1001:d=4", h264);
    lavfi(dir, "mic.mkv", "sine=f=440:r=48000:d=4", [
      "-c:a",
      "aac",
      "-ac",
      "1",
    ]);

    const result = await exportClips(dir, clips);
    commands = result.commands;
    output = result.output;
  }, 120_000);

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("draws each Clip's scene segments in a graph of its own, mic offset and EQ applied", () => {
    const segments = commands.filter(
      (c) => c.startsWith("[export:concat]") && c.includes("-filter_complex")
    );
    expect(segments).toHaveLength(2);
    segments.forEach((command, i) => {
      const clip = clips[i]!;
      expect(command).toContain(
        sceneFilterGraph({
          segments: clip.composite!.segments,
          inputStartSeconds: clip.startTime,
          output: "composite",
        })
      );
      // The mic is read 150 ms earlier than the picture, through OBS's EQ.
      expect(command).toContain(
        `-ss ${clip.startTime - 0.15} -t ${clip.duration} -i ${path.join(dir, "mic.mkv")}`
      );
      expect(command).toContain(micEqFilters(DEFAULT_MIC_EQ).join(","));
    });
    expect(clips[0]!.composite!.segments.map((s) => s.scene)).toEqual([
      "Code",
      "Camera",
    ]);

    const join = commands.filter((c) => c.includes("-f concat"));
    expect(join).toHaveLength(1);
    expect(join[0]).toContain("-c:v copy");
  });

  it("writes CFR 60 H.264 yuv420p with BT.709 tags and AAC 48 kHz", () => {
    const { streams, format } = probe(output);
    const video = streams.find((s) => s.codec_type === "video")!;
    const audio = streams.find((s) => s.codec_type === "audio")!;
    expect(video).toMatchObject({
      codec_name: "h264",
      pix_fmt: "yuv420p",
      r_frame_rate: "60/1",
      color_space: "bt709",
      color_primaries: "bt709",
      color_transfer: "bt709",
    });
    expect(audio).toMatchObject({ codec_name: "aac", sample_rate: "48000" });
    expect(Number(format.duration)).toBeCloseTo(2.5, 1);
  });

  it("shows the screen in the Code scene and the camera in the Camera scene", () => {
    const near = (rgb: number[], expected: number[]) =>
      rgb.every((v, i) => Math.abs(v - expected[i]!) <= 40);
    // 0.5 s in: Code, the screen fills the frame centre.
    expect(near(pixel(output, 0.5, 960, 540), [255, 0, 0])).toBe(true);
    // 1.2 s in (session 1.7 s): Camera, the camera fills it.
    expect(near(pixel(output, 1.2, 960, 540), [0, 255, 0])).toBe(true);
  });
});

/** The times of the frames whose centre is white. */
const flashes = (file: string) =>
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `movie=${file},crop=4:4:958:538,signalstats`,
      "-show_entries",
      "frame=pts_time:frame_tags=lavfi.signalstats.YAVG",
      "-of",
      "csv=p=0",
    ],
    { encoding: "utf8" }
  )
    .trim()
    .split("\n")
    .map((line) => line.split(",").map(Number))
    .filter(([, luma]) => luma! > 128)
    .map(([t]) => t!);

/** The times each beep starts: where silencedetect says a silence ends. */
const beeps = (file: string) => {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      file,
      "-af",
      "silencedetect=n=-30dB:d=0.005",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" }
  );
  return [...result.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) =>
    Number(m[1])
  );
};

/**
 * Clips of an odd length (1.8137 s, not a whole number of 60 fps frames),
 * each holding one screen flash at picture time 2k+0.5 and one mic beep at
 * mic time 2k+0.35 — the same instant, with the 150 ms mic offset. The mic is
 * PCM, so no AAC priming moves the beep.
 *
 * Only the joins before the last ~3 s are checked: the normalize pass's
 * loudnorm moves the sound in its final flush, on every export (the OBS
 * single pass too), which is not the join's doing.
 */
describe.skipIf(!hasFfmpeg)("joining CVM-recorder Clips", () => {
  const dir = path.join(
    os.tmpdir(),
    `composite-join-${process.pid}-${Date.now()}`
  );
  const CLIP = 1.8137;
  const FRAMES = 109; // 1.8137 s rounded up to whole frames
  const clips = [0, 1, 2, 3, 4, 5].map((k) =>
    exportClip(sessionRow(dir, 2 * k + 0.2, 2 * k + 0.2 + CLIP, []))
  );
  let output: string;

  beforeAll(async () => {
    fs.mkdirSync(dir, { recursive: true });
    const h264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
    lavfi(
      dir,
      "screen.mkv",
      "color=c=black:s=320x180:r=60:d=13,drawbox=c=white:t=fill:enable='between(mod(t\\,2)\\,0.499\\,0.509)'",
      h264
    );
    lavfi(dir, "camera.mkv", "color=c=lime:s=384x216:r=30000/1001:d=13", h264);
    lavfi(
      dir,
      "mic.mkv",
      "aevalsrc='if(between(mod(t\\,2)\\,0.35\\,0.40)\\,0.5*sin(2*PI*1000*t)\\,0)+0.003*sin(2*PI*200*t)':s=48000:d=13",
      ["-c:a", "pcm_s16le", "-ac", "1"]
    );
    output = (await exportClips(dir, clips)).output;
  }, 120_000);

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("is true CFR 60: every frame exactly 1/60 s after the last", () => {
    const video = probe(output).streams.find((s) => s.codec_type === "video")!;
    expect(video).toMatchObject({
      r_frame_rate: "60/1",
      avg_frame_rate: "60/1",
      nb_frames: String(clips.length * FRAMES),
    });
    const times = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "packet=pts_time",
        "-of",
        "csv=p=0",
        output,
      ],
      { encoding: "utf8" }
    )
      .trim()
      .split("\n")
      .map(Number)
      .sort((a, b) => a - b);
    times.forEach((t, i) => expect(t - times[0]!).toBeCloseTo(i / 60, 4));
  });

  it("keeps each beep on its flash across every join", () => {
    const allFlashes = flashes(output);
    expect(allFlashes).toHaveLength(clips.length);
    const flashTimes = allFlashes.slice(0, 4);
    const beepTimes = beeps(output).slice(0, 4);
    // Each Clip is a whole number of frames long, the flash 0.3 s into it.
    flashTimes.forEach((t, k) =>
      expect(t).toBeCloseTo((k * FRAMES) / 60 + 0.3, 3)
    );
    beepTimes.forEach((t, k) =>
      expect(Math.abs(t - flashTimes[k]!)).toBeLessThan(0.003)
    );
  });
});

/**
 * A Video's Animatic, encoded through `FFmpegEncodeService.encodeAnimatic`:
 * two stills of different sizes, each held for its segment, each with its
 * voice from its onset and silence to the end of the segment.
 */
describe.skipIf(!hasFfmpeg)("encoding an Animatic", () => {
  const dir = path.join(
    os.tmpdir(),
    `animatic-export-${process.pid}-${Date.now()}`
  );
  let output: string;

  beforeAll(async () => {
    fs.mkdirSync(dir, { recursive: true });
    const still = ["-frames:v", "1"];
    lavfi(dir, "one.png", "color=c=red:s=640x360", still);
    // Square, so it is fitted inside the 16:9 frame with bars.
    lavfi(dir, "two.png", "color=c=blue:s=360x360", still);
    // Kokoro's shape: 24 kHz mono.
    const wav = ["-ar", "24000", "-ac", "1"];
    lavfi(dir, "one.wav", "sine=f=440:r=24000:d=1.2", wav);
    lavfi(dir, "two.wav", "sine=f=660:r=24000:d=0.8", wav);

    output = await Effect.runPromise(
      Effect.gen(function* () {
        const encode = yield* FFmpegEncodeService;
        return yield* encode.encodeAnimatic(
          [
            {
              imageFile: path.join(dir, "one.png"),
              audioFile: path.join(dir, "one.wav"),
              speechStartSeconds: 0.2,
              durationInFrames: 45,
            },
            {
              imageFile: path.join(dir, "two.png"),
              audioFile: path.join(dir, "two.wav"),
              speechStartSeconds: 0,
              durationInFrames: 30,
            },
          ],
          { width: 1920, height: 1080 },
          { onLog: () => {} }
        );
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            FFmpegEncodeService.Default,
            NodeContext.layer,
            SidecarContextTest
          )
        )
      )
    );
  }, 120_000);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (output) fs.rmSync(output, { force: true });
  });

  it("holds each frame for its segment, fitted to the format's frame", () => {
    const { streams, format } = probe(output);
    const video = streams.find((s) => s.codec_type === "video")!;
    expect([video.width, video.height]).toEqual([1920, 1080]);
    expect(Number(format.duration)).toBeCloseTo(2.5, 1);
    // Red for the first 1.5 s, then the square blue one, barred in black.
    expect(pixel(output, 0.7, 960, 540)[0]).toBeGreaterThan(200);
    expect(pixel(output, 2.0, 960, 540)[2]).toBeGreaterThan(200);
    expect(Math.max(...pixel(output, 2.0, 100, 540))).toBeLessThan(30);
  });

  it("carries the voice as 48 kHz stereo, as long as the picture", () => {
    const audio = probe(output).streams.find((s) => s.codec_type === "audio")!;
    expect(Number(audio.sample_rate)).toBe(48000);
    expect(Number(audio.channels)).toBe(2);
    expect(Number(audio.duration)).toBeCloseTo(2.5, 1);
  });
});
