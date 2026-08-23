import path from "node:path";
import { Config, Effect } from "effect";
import type { FileSystem } from "@effect/platform";
import type { FFmpegCommandsService } from "./ffmpeg-commands";
import type { VideoEditorLoggerService } from "./video-editor-logger-service";
import { makeFfmpegLogger } from "./ffmpeg-video-logger";
import {
  VIDEO_FORMAT_DIMENSIONS,
  type VideoFormat,
} from "@/features/videos/video-format";
import type { PauseType } from "./video-processing-service";

/**
 * The ffmpeg passes that turn one Video's Clips into a finished file: the
 * concat-and-normalize export, and the Definition Card compositing that
 * follows it.
 *
 * They are a factory over the three collaborators they need, rather than
 * methods written inline on `VideoProcessingService`, so the export pipeline
 * can be read end to end in one place — the rest of that service is OBS,
 * transcription and DaVinci Resolve, which have nothing to do with it.
 */
export const makeVideoExportPasses = (deps: {
  ffmpegCommands: FFmpegCommandsService;
  effectFs: FileSystem.FileSystem;
  videoEditorLogger: VideoEditorLoggerService;
}) => {
  const { ffmpegCommands, effectFs, videoEditorLogger } = deps;

  const exportVideoClips = Effect.fn("exportVideoClips")(function* (opts: {
    videoId: string;
    format: VideoFormat;
    clips: {
      inputVideo: string;
      startTime: number;
      duration: number;
      pauseType: PauseType;
      zoomType: string;
    }[];
    shortsDirectoryOutputName: string | undefined;
    onStageChange?: (
      stage: "concatenating-clips" | "normalizing-audio"
    ) => void;
    /**
     * Real per-phase progress from the underlying ffmpeg processes.
     * `percent` is an integer 0–99 that resets when the stage changes;
     * 100 is signalled by completion, not by this callback.
     */
    onProgress?: (info: {
      stage: "concatenating-clips" | "normalizing-audio";
      percent: number;
    }) => void;
  }) {
    const FINISHED_VIDEOS_DIRECTORY = yield* Config.string(
      "FINISHED_VIDEOS_DIRECTORY"
    );

    // Every ffmpeg invocation for this export is teed into
    // `.data/logs/{videoId}.log` (fetch its path via VideoEditorLoggerService
    // or GET /api/videos/:videoId/log-path) — the "cli-output" event, on
    // both success and failure, so a rare hang or corrupt export has a
    // durable artifact to diagnose from instead of a swallowed exit code.
    const logCliOutput = (stage: "concat" | "normalize-audio") =>
      makeFfmpegLogger(videoEditorLogger, opts.videoId, `export:${stage}`);

    // Create concatenated video using native FFmpeg, in the aspect ratio
    // that matches the video's format (portrait for shorts, landscape
    // otherwise).
    opts.onStageChange?.("concatenating-clips");
    const concatenatedPath =
      yield* ffmpegCommands.createAndConcatenateVideoClipsSinglePass(
        opts.clips,
        VIDEO_FORMAT_DIMENSIONS[opts.format],
        {
          onProgress: (percent) =>
            opts.onProgress?.({ stage: "concatenating-clips", percent }),
          onLog: logCliOutput("concat"),
        }
      );

    // Normalize audio
    opts.onStageChange?.("normalizing-audio");
    const normalizedPath = yield* ffmpegCommands.normalizeAudio(
      concatenatedPath,
      {
        onProgress: (percent) =>
          opts.onProgress?.({ stage: "normalizing-audio", percent }),
        onLog: logCliOutput("normalize-audio"),
      }
    );

    // Move to final location
    const outputPath = path.join(
      FINISHED_VIDEOS_DIRECTORY,
      `${opts.videoId}.mp4`
    );

    yield* effectFs.makeDirectory(path.dirname(outputPath), {
      recursive: true,
    });
    // Use copy+remove instead of rename to support cross-device moves
    // (e.g. /tmp on tmpfs → /mnt/d on NTFS via WSL2)
    yield* effectFs.copyFile(normalizedPath, outputPath);

    // Measure what was actually produced. ffmpeg exiting zero says only
    // that it stopped without complaining, not that it wrote every frame
    // it was asked for — so the caller, which knows what the Clips asked
    // for, is handed the real number and refuses a short file.
    const durationInSeconds =
      yield* ffmpegCommands.getVideoDurationInSeconds(outputPath);

    // Clean up intermediate files
    yield* effectFs
      .remove(normalizedPath)
      .pipe(Effect.catchAll(() => Effect.void));
    yield* effectFs
      .remove(concatenatedPath)
      .pipe(Effect.catchAll(() => Effect.void));

    return { outputPath, durationInSeconds };
  });

  /**
   * Composite this Video's Definition Cards onto the file the export just
   * produced, in place.
   *
   * It is a pass of its own, after the concat and after the audio
   * normalize, rather than something fused into the per-Clip crop filter:
   * it works on the flattened, continuous timeline, which is the stage a
   * future Transform (a pan/zoom interpolating ACROSS a Clip boundary)
   * needs and a pre-concat per-input filter cannot express.
   *
   * A Video with no Overlays never gets here — the export step skips the
   * call — so its bytes are exactly what they were before Overlays
   * existed.
   */
  const compositeOverlaysOntoExport = Effect.fn("compositeOverlaysOntoExport")(
    function* (opts: {
      videoId: string;
      /** The exported file, composited over and replaced. */
      videoPath: string;
      overlays: ReadonlyArray<{
        overlayPath: string;
        startInSeconds: number;
        endInSeconds: number;
      }>;
      /** What the Clips ask for — the progress denominator. */
      totalDurationSeconds: number;
      onProgress?: (percent: number) => void;
    }) {
      // ffmpeg cannot read and write one file at once, so the pass writes
      // beside the export and the finished file is moved over it.
      const compositedPath = path.join(
        path.dirname(opts.videoPath),
        `.${path.basename(opts.videoPath)}.overlays.mp4`
      );

      yield* ffmpegCommands
        .compositeOverlaysAtOffsets(
          opts.videoPath,
          opts.overlays,
          compositedPath,
          {
            totalDurationSeconds: opts.totalDurationSeconds,
            onProgress: opts.onProgress,
            onLog: makeFfmpegLogger(
              videoEditorLogger,
              opts.videoId,
              "export:composite-overlays"
            ),
          }
        )
        .pipe(
          Effect.tapError(() =>
            effectFs
              .remove(compositedPath)
              .pipe(Effect.catchAll(() => Effect.void))
          )
        );

      yield* effectFs.copyFile(compositedPath, opts.videoPath);
      yield* effectFs
        .remove(compositedPath)
        .pipe(Effect.catchAll(() => Effect.void));

      return opts.videoPath;
    }
  );

  return { exportVideoClips, compositeOverlaysOntoExport };
};
