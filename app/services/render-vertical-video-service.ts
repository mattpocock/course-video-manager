import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Config, Data, Effect, Stream } from "effect";
import path from "node:path";
import { tmpdir } from "os";
import crypto from "node:crypto";
import { VideoOperationsService } from "./db-video-operations.server";
import { VideoProcessingService } from "./video-processing-service";
import { FFmpegCommandsService } from "./ffmpeg-commands";

export type RenderVerticalStage =
  | "concatenating-clips"
  | "transcribing"
  | "rendering-overlay"
  | "compositing";

export class RenderVerticalError extends Data.TaggedError(
  "RenderVerticalError"
)<{
  cause: unknown;
  message: string;
}> {}

export class RenderVerticalVideoService extends Effect.Service<RenderVerticalVideoService>()(
  "RenderVerticalVideoService",
  {
    effect: Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const videoProcessing = yield* VideoProcessingService;
      const ffmpegCommands = yield* FFmpegCommandsService;
      const effectFs = yield* FileSystem.FileSystem;

      const renderVerticalVideo = Effect.fn("renderVerticalVideo")(
        function* (opts: {
          videoId: string;
          onStageChange?: (stage: RenderVerticalStage) => void;
        }) {
          const FINISHED_VIDEOS_DIRECTORY = yield* Config.string(
            "FINISHED_VIDEOS_DIRECTORY"
          );

          const video = yield* videoOps.getVideoWithClipsById(opts.videoId);

          if (video.clips.length === 0) {
            return yield* new RenderVerticalError({
              cause: null,
              message: "Video has no clips to export",
            });
          }

          // Step 1: Concatenate clips → temp file (not the final output path,
          // since the composite step will write the final .mp4)
          opts.onStageChange?.("concatenating-clips");
          const rawConcatenatedPath =
            yield* ffmpegCommands.createAndConcatenateVideoClipsSinglePass(
              video.clips.map((clip) => ({
                inputVideo: clip.videoFilename,
                startTime: clip.sourceStartTime,
                duration: clip.sourceEndTime - clip.sourceStartTime,
                pauseType: clip.pauseType as "none" | "long",
              }))
            );
          const concatenatedPath =
            yield* ffmpegCommands.normalizeAudio(rawConcatenatedPath);

          // Clean up raw concatenated file
          yield* effectFs
            .remove(rawConcatenatedPath)
            .pipe(Effect.catchAll(() => Effect.void));

          // Step 2: Transcribe clips with word timings
          opts.onStageChange?.("transcribing");
          const transcriptions = yield* videoProcessing.transcribeClips(
            video.clips.map((clip) => ({
              id: clip.id,
              inputVideo: clip.videoFilename,
              startTime: clip.sourceStartTime,
              duration: clip.sourceEndTime - clip.sourceStartTime,
            }))
          );

          // Step 3: Get FPS from the concatenated video
          const fps = yield* ffmpegCommands.getFPS(concatenatedPath);

          // Step 4: Convert word timings to frame-based subtitles
          // Word timings from each clip are relative to that clip's start (0-based).
          // We need to offset them by the accumulated duration of preceding clips.
          const subtitles = buildSubtitles(video.clips, transcriptions, fps);

          // Compute total duration in frames
          const totalDuration = video.clips.reduce(
            (acc, clip) => acc + (clip.sourceEndTime - clip.sourceStartTime),
            0
          );
          const durationInFrames = Math.ceil(totalDuration * fps);

          // Step 5: Render Remotion overlay
          opts.onStageChange?.("rendering-overlay");
          const overlayDir = path.join(tmpdir(), "cvm-overlay-render");
          yield* effectFs.makeDirectory(overlayDir, { recursive: true });
          const overlayHash = crypto
            .createHash("sha256")
            .update(opts.videoId + Date.now())
            .digest("hex")
            .slice(0, 12);
          const overlayPath = path.join(overlayDir, `${overlayHash}.mov`);

          const propsJson = JSON.stringify({
            width: 1080,
            height: 1920,
            fps,
            durationInFrames,
            subtitles,
            cta: null,
          });

          yield* renderOverlay(effectFs, propsJson, overlayPath);

          // Step 6: Composite overlay onto concatenated video
          opts.onStageChange?.("compositing");
          const outputPath = path.join(
            FINISHED_VIDEOS_DIRECTORY,
            `${opts.videoId}.mp4`
          );
          yield* effectFs.makeDirectory(path.dirname(outputPath), {
            recursive: true,
          });

          yield* compositeOverlay(concatenatedPath, overlayPath, outputPath);

          // Clean up intermediate files
          yield* effectFs
            .remove(overlayPath)
            .pipe(Effect.catchAll(() => Effect.void));
          yield* effectFs
            .remove(concatenatedPath)
            .pipe(Effect.catchAll(() => Effect.void));

          return outputPath;
        }
      );

      return { renderVerticalVideo };
    }),
    dependencies: [
      NodeContext.layer,
      VideoProcessingService.Default,
      FFmpegCommandsService.Default,
    ],
  }
) {}

/**
 * Build frame-based subtitles from per-clip word transcriptions.
 *
 * Each clip's word timings are 0-based relative to the extracted audio segment.
 * We offset them by the accumulated duration of preceding clips to place them
 * on the concatenated timeline, then convert seconds → frames.
 */
export function buildSubtitles(
  clips: readonly { sourceStartTime: number; sourceEndTime: number }[],
  transcriptions: readonly {
    id: string;
    words: readonly { start: number; end: number; text: string }[];
  }[],
  fps: number
): { startFrame: number; endFrame: number; text: string }[] {
  const subtitles: { startFrame: number; endFrame: number; text: string }[] =
    [];
  let timelineOffset = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i]!;
    const transcription = transcriptions[i];
    const clipDuration = clip.sourceEndTime - clip.sourceStartTime;

    if (transcription) {
      for (const word of transcription.words) {
        subtitles.push({
          startFrame: Math.round((timelineOffset + word.start) * fps),
          endFrame: Math.round((timelineOffset + word.end) * fps),
          text: word.text,
        });
      }
    }

    timelineOffset += clipDuration;
  }

  return subtitles;
}

function renderOverlay(
  effectFs: FileSystem.FileSystem,
  propsJson: string,
  overlayPath: string
) {
  return Effect.gen(function* () {
    const propsDir = path.join(tmpdir(), "cvm-overlay-props");
    yield* effectFs.makeDirectory(propsDir, { recursive: true });
    const propsHash = crypto
      .createHash("sha256")
      .update(propsJson)
      .digest("hex")
      .slice(0, 12);
    const propsFile = path.join(propsDir, `${propsHash}.json`);
    yield* effectFs.writeFileString(propsFile, propsJson);

    const binPath = path.resolve(
      __dirname,
      "../../packages/subtitle-overlay-renderer/bin.mjs"
    );

    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const process = yield* Command.start(
          Command.make(
            "node",
            binPath,
            "--props-file",
            propsFile,
            "--out",
            overlayPath,
            "--quiet"
          )
        ).pipe(
          Effect.mapError(
            (e) =>
              new RenderVerticalError({
                cause: e,
                message: `Failed to start overlay renderer: ${e.message}`,
              })
          )
        );

        const [stdout, stderr] = yield* Effect.all(
          [
            process.stdout.pipe(Stream.decodeText(), Stream.mkString),
            process.stderr.pipe(Stream.decodeText(), Stream.mkString),
          ],
          { concurrency: 2 }
        );

        const exitCode = yield* process.exitCode;
        if (exitCode !== 0) {
          yield* new RenderVerticalError({
            cause: null,
            message: `Overlay renderer exited with code ${exitCode}: ${stderr}`,
          });
        }

        return stdout;
      })
    );

    // Clean up props file
    yield* effectFs.remove(propsFile).pipe(Effect.catchAll(() => Effect.void));

    return result;
  });
}

function compositeOverlay(
  videoPath: string,
  overlayPath: string,
  outputPath: string
) {
  const args = [
    "-y",
    "-hide_banner",
    "-i",
    videoPath,
    "-i",
    overlayPath,
    "-filter_complex",
    "[0:v][1:v]overlay=0:0:format=auto[outv]",
    "-map",
    "[outv]",
    "-map",
    "0:a",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  return Effect.gen(function* () {
    const code = yield* Command.exitCode(
      Command.make("ffmpeg", ...args).pipe(
        Command.stdout("inherit"),
        Command.stderr("inherit")
      )
    ).pipe(
      Effect.mapError(
        (e) =>
          new RenderVerticalError({
            cause: e,
            message: `Failed to composite overlay: ${e.message}`,
          })
      )
    );
    if (code !== 0) {
      yield* new RenderVerticalError({
        cause: null,
        message: `ffmpeg composite exited with code ${code}`,
      });
    }
  });
}
