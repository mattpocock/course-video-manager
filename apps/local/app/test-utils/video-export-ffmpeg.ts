import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { NodeContext } from "@effect/platform-node";
import { FileSystem } from "@effect/platform";
import { ConfigProvider, Effect, Layer } from "effect";
import type { ClipLayerRow } from "@cvm/core/features/videos/clip-layer";
import { clipComposite, clipLayers, clipSource } from "@/packages/clip-source";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { FFmpegEncodeService } from "@/services/ffmpeg-encode-commands";
import { SidecarContextTest } from "@/services/sidecar-context";
import { makeVideoExportPasses } from "@/services/video-export-passes";
import { idleGpuGate } from "@/test-utils/idle-gpu-gate";

/**
 * What the export's ffmpeg tests share: the real export pass run over tiny
 * synthetic stand-ins (lavfi colours and sines; no device), and the probes
 * that read the picture and the sound back.
 */

export const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

export const lavfi = (
  dir: string,
  name: string,
  source: string,
  codec: string[]
) => {
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

export const probe = (file: string) =>
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
export const pixel = (file: string, t: number, x: number, y: number) => [
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
export const exportClips = async (
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
          FFmpegEncodeService.Default.pipe(Layer.provide(idleGpuGate)),
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

export const sessionRow = (
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

export const exportClip = (
  row: ReturnType<typeof sessionRow> & { layers?: ClipLayerRow[] }
) => {
  const source = clipSource(row);
  return {
    inputVideo: row.videoFilename,
    startTime: row.sourceStartTime,
    duration: row.sourceEndTime - row.sourceStartTime,
    pauseType: "none" as const,
    zoomType: "none",
    composite: clipComposite(source),
    layers: clipLayers(source),
  };
};

/** Each frame's time and the luma of its centre. */
export const centreLumas = (file: string) =>
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
    .map((line) => line.split(",").map(Number) as [number, number]);

/** The times of the frames whose centre is white. */
export const flashes = (file: string) =>
  centreLumas(file)
    .filter(([, luma]) => luma > 128)
    .map(([t]) => t);

/** The times each beep starts: where silencedetect says a silence ends. */
export const beeps = (file: string) => {
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
