import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Data, Effect, Ref, Stream } from "effect";
import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "os";
import { registerFfmpegChild } from "./ffmpeg-child-registry";
import { createFfmpegProgressParser } from "./ffmpeg-progress";
import { appendBoundedTail, withStderrTail } from "./ffmpeg-log-capture";
import { clipZoomCropFilter } from "@/features/videos/clip-zoom";
import { clipExportDurationInSeconds } from "./export-duration-check";

/** Emitted once a command has run (success or failure) so a caller that
 * knows the domain object (a videoId) can tee it into a durable, agent- and
 * human-readable log — see VideoEditorLoggerService's "cli-output" event. */
export type FfmpegLogInfo = { command: string[]; stderrTail: string };

const GPU_PERMITS = 6;
const CPU_PERMITS = 12;

/**
 * Written before every output file in the export pipeline, so that an export's
 * bytes are a function of its inputs and nothing else.
 *
 * Without these, ffmpeg stamps the running library versions into the file — an
 * `encoder=Lavf60.16.100` format tag and an `encoder=Lavc60.31.102 h264_nvenc`
 * stream tag. Neither changes a frame, but both change the SHA256 that the
 * published manifest carries and that AI Hero uses to decide whether a Video is
 * new. Upgrading ffmpeg would otherwise re-ingest the whole catalogue into Mux.
 *
 * They must go on every pass, not just the last: the stream tag is written by
 * the pass that encodes the stream and survives the later stream-copy.
 *
 * Reproducibility here is per-machine — same ffmpeg build, same driver, same
 * GPU. These flags remove the part that was gratuitously variable.
 */
const BITEXACT_ARGS = [
  "-fflags",
  "+bitexact",
  "-flags:v",
  "+bitexact",
  "-flags:a",
  "+bitexact",
];

class FFmpegError extends Data.TaggedError("FFmpegError")<{
  cause: unknown;
  message: string;
}> {}

export class FFmpegCommandsService extends Effect.Service<FFmpegCommandsService>()(
  "FFmpegCommandsService",
  {
    effect: Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const gpuSemaphore = yield* Effect.makeSemaphore(GPU_PERMITS);
      const cpuSemaphore = yield* Effect.makeSemaphore(CPU_PERMITS);

      /**
       * Run a long-lived ffmpeg encode with real progress reporting.
       *
       * `-progress pipe:1` makes ffmpeg emit key=value progress blocks on
       * stdout (which nothing else uses), parsed incrementally into integer
       * percents of `totalDurationSeconds` (see createFfmpegProgressParser for
       * the emission contract). `-nostats` drops the carriage-return stats
       * line from the inherited stderr, which otherwise duplicates the same
       * numbers as terminal noise.
       *
       * Runs under a scope, so fiber interruption (SSE disconnect, cancelled
       * publish) kills the child; the PID is also registered with the
       * parent-death backstop (see ffmpeg-child-registry) for the case where
       * the dev server itself dies without interrupting any fiber.
       *
       * Both stdout (progress) and stderr (diagnostics) are piped rather than
       * inherited, and BOTH are drained concurrently via a single
       * `Effect.all`. That concurrency is load-bearing, not incidental: a
       * piped OS stream that nobody reads fills its buffer (~64KB) and blocks
       * the writer, so draining stdout to completion before even starting to
       * drain stderr would recreate, on stderr, the exact hang this function
       * exists to prevent on stdout.
       *
       * Each drained chunk is handled in isolation — a throw anywhere
       * downstream of `onProgress` (most plausibly an SSE controller whose
       * client has gone away) must never stop that stream's loop. If it did,
       * nobody would read that pipe again, ffmpeg's next write to it would
       * block on a full buffer, and the encode would hang forever — a hang
       * invisible to `Effect.retry`, since a process that never exits never
       * resolves to a failure to retry.
       */
      const runFfmpegWithProgress = Effect.fn("runFfmpegWithProgress")(
        function* (opts: {
          args: string[];
          totalDurationSeconds: number;
          onProgress: ((percent: number) => void) | undefined;
          // Required, not optional: an omitted onLog silently drops the
          // per-video log this function exists to feed — see the
          // "optional parameters" note in .sandcastle/CODING_STANDARDS.md.
          // A caller with nothing to do about it passes a no-op explicitly.
          onLog: (info: FfmpegLogInfo) => void;
          errorPrefix: string;
        }) {
          const commandLine = ["ffmpeg", ...opts.args];
          const toError = (
            cause: unknown,
            detail: string,
            stderrTail: string
          ) =>
            new FFmpegError({
              cause,
              message: withStderrTail(
                `${opts.errorPrefix}${detail}`,
                stderrTail
              ),
            });

          yield* Effect.scoped(
            Effect.gen(function* () {
              const child = yield* Command.start(
                Command.make(
                  "ffmpeg",
                  "-nostats",
                  "-progress",
                  "pipe:1",
                  ...opts.args
                )
              ).pipe(Effect.mapError((e) => toError(e, `: ${e.message}`, "")));

              yield* Effect.acquireRelease(
                Effect.sync(() => registerFfmpegChild(child.pid)),
                (unregister) => Effect.sync(unregister)
              );

              const parser = createFfmpegProgressParser({
                totalDurationSeconds: opts.totalDurationSeconds,
                onPercent: opts.onProgress ?? (() => {}),
              });

              // Drain stdout even when nobody listens — an unread pipe would
              // eventually block ffmpeg. The stream ends when the process
              // does. A failing chunk (see the function doc) is contained
              // right here, per chunk, so the loop keeps running instead of
              // Effect.ignore below only stopping it after the fact.
              const drainStdout = child.stdout.pipe(
                Stream.decodeText(),
                Stream.runForEach((chunk) =>
                  Effect.sync(() => parser.push(chunk)).pipe(
                    Effect.catchAllCause(() => Effect.void)
                  )
                ),
                Effect.ignore
              );

              // Tee stderr to our own stderr (so a developer watching the
              // terminal sees what they always have) while accumulating a
              // bounded tail for the error message and the per-video log.
              // Written into a Ref rather than folded through the stream's
              // own return value: a Ref keeps whatever was captured so far
              // even if the stream itself dies partway (a decode error, a
              // closed fd) — the same per-chunk containment as stdout above,
              // so one bad chunk can't cost the whole tail.
              const stderrTailRef = yield* Ref.make("");
              const drainStderr = child.stderr.pipe(
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

              yield* Effect.all([drainStdout, drainStderr], {
                concurrency: 2,
              });
              const stderrTail = yield* Ref.get(stderrTailRef);

              opts.onLog({ command: commandLine, stderrTail });

              const code = yield* child.exitCode.pipe(
                Effect.mapError((e) => toError(e, `: ${e.message}`, stderrTail))
              );
              if (code !== 0) {
                yield* toError(null, `, exit code: ${code}`, stderrTail);
              }
            })
          );
        }
      );

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
          "-c:v",
          "h264_nvenc",
          "-preset",
          "slow",
          "-rc:v",
          "vbr",
          "-cq:v",
          "19",
          "-b:v",
          "15387k",
          "-maxrate",
          "20000k",
          "-bufsize",
          "30000k",
          "-fps_mode",
          "cfr",
          "-r",
          "60",
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
        captureFrameAtTime,
      };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
