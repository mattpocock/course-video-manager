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

          // Step 2: Transcribe the concatenated video in a single pass. Because
          // Whisper runs on the already concatenated + normalized audio, its
          // segment timestamps are on the final timeline — no per-clip offset,
          // and the long-pause padding / audio normalization are accounted for.
          opts.onStageChange?.("transcribing");
          const transcription =
            yield* videoProcessing.transcribeVideoFile(concatenatedPath);

          // Step 3: Get FPS from the concatenated video
          const fps = yield* ffmpegCommands.getFPS(concatenatedPath);

          // Step 4: Split long segments into short phrases and convert to frames
          const subtitles = buildSubtitles(transcription.segments, fps);

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

          yield* ffmpegCommands.compositeOverlay(
            concatenatedPath,
            overlayPath,
            outputPath
          );

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

/** A caption segment timed in seconds, as returned by Whisper. */
type SubtitleSegment = { start: number; end: number; text: string };

/**
 * The longest a single on-screen subtitle may be before it is split into
 * multiple phrases. Ported verbatim from the original Total TypeScript renderer.
 */
const MAXIMUM_SUBTITLE_LENGTH_IN_CHARS = 32;

/**
 * Split a Whisper segment that is longer than
 * {@link MAXIMUM_SUBTITLE_LENGTH_IN_CHARS} into several shorter phrases,
 * distributing the words evenly and dividing the segment's time span evenly
 * across the resulting chunks.
 *
 * Ported verbatim from the original Total TypeScript renderer's
 * `splitSubtitleSegments`. Timing is by even division (not per-word
 * timestamps), which is the behaviour we are intentionally reproducing.
 */
export function splitSubtitleSegments(
  subtitle: SubtitleSegment
): SubtitleSegment[] {
  if (subtitle.text.length <= MAXIMUM_SUBTITLE_LENGTH_IN_CHARS) {
    return [subtitle];
  }

  const numChunks = Math.ceil(
    subtitle.text.length / MAXIMUM_SUBTITLE_LENGTH_IN_CHARS
  );

  const words = subtitle.text.split(" ");
  const wordsPerChunk = Math.ceil(words.length / numChunks);

  const chunks: SubtitleSegment[] = [];
  const duration = subtitle.end - subtitle.start;
  const chunkDuration = duration / numChunks;

  for (let i = 0; i < numChunks; i++) {
    const startTime = subtitle.start + i * chunkDuration;
    const endTime = startTime + chunkDuration;

    const startWordIndex = i * wordsPerChunk;
    const endWordIndex = startWordIndex + wordsPerChunk;

    chunks.push({
      start: startTime,
      end: endTime,
      text: words.slice(startWordIndex, endWordIndex).join(" ").trim(),
    });
  }

  return chunks;
}

/**
 * Build frame-based subtitles from Whisper segments of the concatenated video.
 *
 * The segment timestamps are already on the final timeline (Whisper transcribes
 * the concatenated + normalized audio), so there is no per-clip offset. Long
 * segments are split into short phrases, then seconds are converted to frames.
 */
export function buildSubtitles(
  segments: readonly SubtitleSegment[],
  fps: number
): { startFrame: number; endFrame: number; text: string }[] {
  return segments
    .flatMap((segment) => splitSubtitleSegments(segment))
    .map((subtitle) => ({
      startFrame: Math.floor(subtitle.start * fps),
      endFrame: Math.floor(subtitle.end * fps),
      text: subtitle.text.trim(),
    }));
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
      import.meta.dirname,
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
