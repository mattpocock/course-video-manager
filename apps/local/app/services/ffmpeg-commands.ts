import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect, Ref, Stream } from "effect";
import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "os";
import { registerFfmpegChild } from "./ffmpeg-child-registry";
import { appendBoundedTail, withStderrTail } from "./ffmpeg-log-capture";
import {
  BITEXACT_ARGS,
  LANDSCAPE_VIDEO_ENCODE_ARGS,
  FFmpegError,
  runFfmpegWithProgress,
  type FfmpegLogInfo,
} from "./ffmpeg-run";
import { clipZoomCropFilter } from "@/features/videos/clip-zoom";
import { clipExportDurationInSeconds } from "./export-duration-check";
import {
  buildOverlayCompositeArgs,
  type RenderedOverlay,
} from "./overlay-compositing";

export type { FfmpegLogInfo };

const GPU_PERMITS = 6;
const CPU_PERMITS = 12;

export class FFmpegCommandsService extends Effect.Service<FFmpegCommandsService>()(
  "FFmpegCommandsService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const gpuSemaphore = yield* Effect.makeSemaphore(GPU_PERMITS);
      const cpuSemaphore = yield* Effect.makeSemaphore(CPU_PERMITS);

      const detectSilence = Effect.fn("detectSilence")(function* (
        inputVideo: string,
        opts: {
          threshold: number | string;
          silenceDuration: number | string;
          startTime?: number;
        }
      ) {
        const args: string[] = ["-hide_banner", "-vn"];
        if (opts.startTime != null) {
          args.push("-ss", String(opts.startTime));
        }
        args.push(
          "-i",
          inputVideo,
          "-af",
          `silencedetect=n=${opts.threshold}dB:d=${opts.silenceDuration}`,
          "-f",
          "null",
          "-"
        );

        return yield* cpuSemaphore.withPermits(1)(
          Effect.scoped(
            Effect.gen(function* () {
              const process = yield* Command.start(
                Command.make("ffmpeg", ...args)
              );
              // ffmpeg exits non-zero with -f null, but we still get the output
              // silencedetect info is written to stderr
              const [stdout, stderr] = yield* Effect.all(
                [
                  process.stdout.pipe(Stream.decodeText(), Stream.mkString),
                  process.stderr.pipe(Stream.decodeText(), Stream.mkString),
                ],
                { concurrency: 2 }
              );
              yield* process.exitCode.pipe(Effect.ignore);
              return stdout + stderr;
            })
          )
        );
      });

      const getFPS = Effect.fn("getFPS")(function* (inputVideo: string) {
        const command = Command.make(
          "ffprobe",
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=r_frame_rate",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          inputVideo
        );

        const result = yield* cpuSemaphore.withPermits(1)(
          Command.string(command)
        );

        const trimmed = result.trim();
        // Parse fraction like "60/1" or "30000/1001"
        const parts = trimmed.split("/");
        if (parts.length === 2) {
          return Number(parts[0]) / Number(parts[1]);
        }
        return Number(trimmed);
      });

      /**
       * The container duration of a finished file, in seconds.
       *
       * Container rather than stream duration: it is what a player reports and
       * what the truncation check compares against, and it is the measure that
       * found the three short exports on disk.
       */
      const getVideoDurationInSeconds = Effect.fn("getVideoDurationInSeconds")(
        function* (inputVideo: string) {
          const command = Command.make(
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            inputVideo
          );
          const result = yield* cpuSemaphore.withPermits(1)(
            Command.string(command)
          );
          return Number(result.trim());
        }
      );

      const createAndConcatenateVideoClipsSinglePass = Effect.fn(
        "createAndConcatenateVideoClipsSinglePass"
      )(function* (
        clips: readonly {
          inputVideo: string;
          startTime: number;
          duration: number;
          pauseType: "none" | "long";
          zoomType?: string;
        }[],
        dimensions: { width: number; height: number },
        // A single required object rather than stacking positional optionals:
        // onProgress may reasonably be skipped (progress reporting is a UI
        // nicety), but onLog must not be — an omitted logger silently drops
        // the per-video log this function exists to feed. See the "optional
        // parameters" note in .sandcastle/CODING_STANDARDS.md.
        extras: {
          onProgress?: (percent: number) => void;
          onLog: (info: FfmpegLogInfo) => void;
        }
      ) {
        const outputDir = path.join(tmpdir(), "video-processing");
        yield* fs.makeDirectory(outputDir, { recursive: true });

        const outputHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(clips) + Date.now())
          .digest("hex")
          .slice(0, 12);
        const outputFile = path.join(outputDir, `${outputHash}.mp4`);

        // Build input args. The summed -t values are also the expected output
        // duration (the concat filter output is exactly the clips end to end),
        // which anchors the progress percentage.
        const inputArgs: string[] = [];
        let expectedOutputDuration = 0;
        for (const clip of clips) {
          const duration = clipExportDurationInSeconds(clip);
          expectedOutputDuration += duration;
          inputArgs.push(
            "-ss",
            clip.startTime.toString(),
            "-t",
            duration.toString(),
            "-i",
            clip.inputVideo
          );
        }

        // Build filter complex. Normalize every input to the target frame (and
        // stereo audio) so the concat filter — which requires all inputs to
        // share dimensions/SAR/channel layout — accepts odd effect clips (e.g.
        // white noise at 854x480 mono). The target dimensions come from the
        // video's format: portrait 1080x1920 for shorts (whose 9:16 subtitle
        // overlay must line up), landscape 1920x1080 otherwise. Passing the
        // wrong dimensions here is what previously forced every export portrait.
        //
        // A Clip Zoom's crop goes BEFORE that scale, so a source larger than
        // the output frame is cropped and then scaled DOWN — the zoom spends
        // surplus resolution rather than upscaling. Cropping after the scale
        // would discard those pixels first and stretch what remained. The crop
        // string comes from clipZoomCropFilter, the same rect the editor
        // preview's CSS transform is formatted from.
        const filterParts: string[] = [];
        const concatInputs: string[] = [];
        for (let i = 0; i < clips.length; i++) {
          const cropFilter = clipZoomCropFilter(clips[i]!.zoomType);
          filterParts.push(
            `[${i}:v]setpts=PTS-STARTPTS,${
              cropFilter ? `${cropFilter},` : ""
            }scale=${dimensions.width}:${dimensions.height},setsar=1[v${i}]`,
            `[${i}:a]asetpts=PTS-STARTPTS,aformat=channel_layouts=stereo[a${i}]`
          );
          concatInputs.push(`[v${i}][a${i}]`);
        }
        filterParts.push(
          `${concatInputs.join("")}concat=n=${clips.length}:v=1:a=1[outv][outa]`
        );

        const filterComplex = filterParts.join(";");

        const args = [
          "-y",
          "-hide_banner",
          ...inputArgs,
          "-filter_complex",
          filterComplex,
          "-map",
          "[outv]",
          "-map",
          "[outa]",
          ...LANDSCAPE_VIDEO_ENCODE_ARGS,
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-b:a",
          "320k",
          "-async",
          "1",
          "-movflags",
          "+faststart",
          ...BITEXACT_ARGS,
          outputFile,
        ];

        yield* gpuSemaphore.withPermits(1)(
          runFfmpegWithProgress({
            args,
            totalDurationSeconds: expectedOutputDuration,
            onProgress: extras.onProgress,
            onLog: extras.onLog,
            errorPrefix: "Failed to create concatenated video",
          })
        );

        return outputFile;
      });

      const normalizeAudio = Effect.fn("normalizeAudio")(function* (
        inputVideo: string,
        extras: {
          onProgress?: (percent: number) => void;
          onLog: (info: FfmpegLogInfo) => void;
        }
      ) {
        const outputDir = path.join(tmpdir(), "video-processing");
        yield* fs.makeDirectory(outputDir, { recursive: true });

        const outputHash = crypto
          .createHash("sha256")
          .update(inputVideo + "-normalized-" + Date.now())
          .digest("hex")
          .slice(0, 12);
        const outputFile = path.join(outputDir, `${outputHash}.mp4`);

        // Get video and audio durations
        const getStreamDuration = (streamType: string) =>
          Effect.gen(function* () {
            const command = Command.make(
              "ffprobe",
              "-v",
              "error",
              "-select_streams",
              `${streamType}:0`,
              "-show_entries",
              "stream=duration",
              "-of",
              "default=noprint_wrappers=1:nokey=1",
              inputVideo
            );
            const result = yield* Command.string(command);
            return Number(result.trim());
          });

        const videoDuration = yield* getStreamDuration("v");
        const audioDuration = yield* getStreamDuration("a");

        const stretchFactor = videoDuration / audioDuration;
        const needsStretching = Math.abs(stretchFactor - 1) > 0.001; // >10ms drift

        const audioFilters: string[] = [];
        if (needsStretching) {
          audioFilters.push(`atempo=${stretchFactor}`);
        }
        audioFilters.push("loudnorm=I=-16:TP=-1.5:LRA=11");

        const args = [
          "-y",
          "-hide_banner",
          "-i",
          inputVideo,
          "-c:v",
          "copy",
          "-af",
          audioFilters.join(","),
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-b:a",
          "320k",
          ...BITEXACT_ARGS,
          outputFile,
        ];

        yield* cpuSemaphore.withPermits(1)(
          runFfmpegWithProgress({
            args,
            // Video is stream-copied, so the output duration is the input's.
            totalDurationSeconds: videoDuration,
            onProgress: extras.onProgress,
            onLog: extras.onLog,
            errorPrefix: "Failed to normalize audio",
          })
        );

        return outputFile;
      });

      const compositeOverlay = Effect.fn("compositeOverlay")(function* (
        videoPath: string,
        overlayPath: string,
        outputPath: string,
        // Required, not optional — see the note on runFfmpegWithProgress.
        onLog: (info: FfmpegLogInfo) => void
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
          ...BITEXACT_ARGS,
          outputPath,
        ];
        const commandLine = ["ffmpeg", ...args];

        // Scoped (so an interrupted fiber kills the child) and registered
        // with the parent-death backstop (so a dev-server restart mid-render
        // doesn't orphan it) — this was previously the one ffmpeg call in the
        // export path missing both, despite being the final, often longest
        // step of a Short's render (libx264 "slow"). Only stderr is piped:
        // stdout carries no progress data here, so inheriting it is exempt
        // from the drain-or-block hazard documented on runFfmpegWithProgress.
        yield* gpuSemaphore.withPermits(1)(
          Effect.scoped(
            Effect.gen(function* () {
              const child = yield* Command.start(
                Command.make("ffmpeg", ...args).pipe(Command.stdout("inherit"))
              ).pipe(
                Effect.mapError(
                  (e) =>
                    new FFmpegError({
                      cause: e,
                      message: `Failed to composite overlay: ${e.message}`,
                    })
                )
              );

              yield* Effect.acquireRelease(
                Effect.sync(() => registerFfmpegChild(child.pid)),
                (unregister) => Effect.sync(unregister)
              );

              // Same Ref-backed, per-chunk-contained capture as
              // runFfmpegWithProgress's stderr drain — see its comment for
              // why a Ref (not the stream's own fold result) is what
              // survives a mid-stream failure.
              const stderrTailRef = yield* Ref.make("");
              yield* child.stderr.pipe(
                Stream.decodeText(),
                Stream.runForEach((chunk) =>
                  Effect.sync(() => {
                    try {
                      process.stderr.write(chunk);
                    } catch {
                      // Best-effort tee only; never let a closed fd stop capture.
                    }
                  }).pipe(
                    Effect.zipRight(
                      Ref.update(stderrTailRef, (tail) =>
                        appendBoundedTail(tail, chunk)
                      )
                    ),
                    Effect.catchAllCause(() => Effect.void)
                  )
                ),
                Effect.ignore
              );
              const stderrTail = yield* Ref.get(stderrTailRef);

              onLog({ command: commandLine, stderrTail });

              const code = yield* child.exitCode.pipe(
                Effect.mapError(
                  (e) =>
                    new FFmpegError({
                      cause: e,
                      message: withStderrTail(
                        `Failed to composite overlay: ${e.message}`,
                        stderrTail
                      ),
                    })
                )
              );
              if (code !== 0) {
                yield* new FFmpegError({
                  cause: null,
                  message: withStderrTail(
                    `ffmpeg composite exited with code ${code}`,
                    stderrTail
                  ),
                });
              }
            })
          )
        );

        return outputPath;
      });

      /**
       * Composite N transparent Definition Card renders onto one video in a
       * single pass, each shown only for its own span of the timeline.
       *
       * Deliberately NOT a widening of `compositeOverlay`: that one is the
       * vertical Shorts pipeline's single, full-length subtitle track, encoded
       * with libx264, and its bytes must not move. This one is the
       * landscape/course export's sparse, time-gated overlays, and it re-encodes
       * a file the concat pass has already written — so it takes its picture
       * settings from {@link LANDSCAPE_VIDEO_ENCODE_ARGS}, the same ones that
       * pass used, rather than from the Shorts burn-in it resembles. A course
       * video with a Definition Card is otherwise a second-generation CPU
       * re-encode with different characteristics from every course video
       * without one.
       *
       * The command line itself is built — and tested — by
       * {@link buildOverlayCompositeArgs}.
       */
      const compositeOverlaysAtOffsets = Effect.fn(
        "compositeOverlaysAtOffsets"
      )(function* (
        videoPath: string,
        overlays: ReadonlyArray<RenderedOverlay>,
        outputPath: string,
        extras: {
          /** What the caller's Clips ask for — the progress denominator. */
          totalDurationSeconds: number;
          onProgress?: (percent: number) => void;
          // Required, not optional — see the note on runFfmpegWithProgress.
          onLog: (info: FfmpegLogInfo) => void;
        }
      ) {
        const args = buildOverlayCompositeArgs(videoPath, overlays, outputPath);
        if (!args) {
          // A caller with nothing to composite must skip the pass, not ask
          // for one: re-encoding a video to change none of it would move its
          // bytes for no reason.
          return yield* new FFmpegError({
            cause: null,
            message: "Cannot composite overlays: no overlays were given",
          });
        }

        yield* gpuSemaphore.withPermits(1)(
          runFfmpegWithProgress({
            args,
            totalDurationSeconds: extras.totalDurationSeconds,
            onProgress: extras.onProgress,
            onLog: extras.onLog,
            errorPrefix: "Failed to composite overlays",
          })
        );

        return outputPath;
      });

      const captureFrameAtTime = Effect.fn("captureFrameAtTime")(function* (
        inputVideo: string,
        timestamp: number,
        outputPath: string
      ) {
        const args = [
          "-y",
          "-hide_banner",
          "-ss",
          String(timestamp),
          "-i",
          inputVideo,
          "-vframes",
          "1",
          "-vf",
          "scale=-2:720",
          "-q:v",
          "2",
          outputPath,
        ];

        yield* cpuSemaphore.withPermits(1)(
          Effect.gen(function* () {
            const code = yield* Command.exitCode(
              Command.make("ffmpeg", ...args).pipe(
                Command.stdout("inherit"),
                Command.stderr("inherit")
              )
            ).pipe(
              Effect.mapError(
                (e) =>
                  new FFmpegError({
                    cause: e,
                    message: `Failed to capture frame at ${timestamp}s: ${e.message}`,
                  })
              )
            );
            if (code !== 0) {
              yield* new FFmpegError({
                cause: null,
                message: `Failed to capture frame at ${timestamp}s, exit code: ${code}`,
              });
            }
          })
        );

        return outputPath;
      });

      return {
        detectSilence,
        getFPS,
        getVideoDurationInSeconds,
        createAndConcatenateVideoClipsSinglePass,
        normalizeAudio,
        compositeOverlay,
        compositeOverlaysAtOffsets,
        captureFrameAtTime,
      };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
