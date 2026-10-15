import { Command } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Effect, Stream } from "effect";
import {
  cpuFallbackArgs,
  FFmpegError,
  withGpuDecode,
  type FfmpegLogInfo,
} from "./ffmpeg-error";
import { appendBoundedTail } from "./ffmpeg-log-capture";
import { FfmpegPermitsService } from "./ffmpeg-permits";
import { clipFrameFfmpegArgs, type ClipFrame } from "@/packages/clip-source";
import {
  silencedetectFilter,
  type SilenceRule,
} from "@/silence-detection-constants";

export type { FfmpegLogInfo };

export class FFmpegCommandsService extends Effect.Service<FFmpegCommandsService>()(
  "FFmpegCommandsService",
  {
    effect: Effect.gen(function* () {
      const { cpuSemaphore } = yield* FfmpegPermitsService;

      const detectSilence = Effect.fn("detectSilence")(function* (
        inputVideo: string,
        opts: {
          rule: SilenceRule;
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
          silencedetectFilter(opts.rule),
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

      /**
       * One ffmpeg run, stderr teed to ours (a developer watching the
       * terminal sees what they always have) and kept for the fallback check.
       */
      const runOnce = (args: readonly string[], lowPriority: boolean) =>
        Effect.scoped(
          Effect.gen(function* () {
            // `nice -n 19 ffmpeg …`: behind the rest of WSL.
            const [file, ...rest]: [string, ...string[]] = lowPriority
              ? ["nice", "-n", "19", "ffmpeg", ...args]
              : ["ffmpeg", ...args];
            const command = Command.make(file, ...rest);
            const child = yield* Command.start(
              command.pipe(Command.stdout("inherit"))
            );
            const stderrTail = yield* child.stderr.pipe(
              Stream.decodeText(),
              Stream.tap((chunk) =>
                Effect.sync(() => {
                  try {
                    process.stderr.write(chunk);
                  } catch {
                    // Best-effort tee only.
                  }
                })
              ),
              Stream.runFold("", (tail, chunk) =>
                appendBoundedTail(tail, chunk)
              )
            );
            const code = yield* child.exitCode;
            return { code: Number(code), stderrTail };
          })
        );

      /**
       * A still (a screenshot, a Clip's first or last frame): every input
       * decoded on the GPU (NVDEC), and run once more on the CPU when there is
       * no usable GPU (`cpuFallbackArgs`). Answers ffmpeg's exit code.
       * `lowPriority` runs it under `nice -n 19`, behind the rest of WSL.
       */
      const runStill = Effect.fn("runStill")(function* (
        args: readonly string[],
        opts?: { lowPriority?: boolean }
      ) {
        const lowPriority = opts?.lowPriority ?? false;
        const gpuArgs = withGpuDecode(args);
        const first = yield* runOnce(gpuArgs, lowPriority);
        if (first.code === 0) return 0;
        const fallbackArgs = cpuFallbackArgs(gpuArgs, first.stderrTail);
        if (!fallbackArgs) return first.code;
        yield* Effect.logWarning(
          "ffmpeg: no usable GPU to decode a still on; running it again on the CPU"
        );
        return (yield* runOnce(fallbackArgs, lowPriority)).code;
      });

      const captureFrameAtTime = Effect.fn("captureFrameAtTime")(function* (
        frame: ClipFrame,
        outputPath: string
      ) {
        const args = [
          "-y",
          "-hide_banner",
          ...clipFrameFfmpegArgs(frame, {
            seek: String(frame.time),
            filter: "scale=-2:720",
          }),
          "-vframes",
          "1",
          "-q:v",
          "2",
          outputPath,
        ];

        yield* cpuSemaphore.withPermits(1)(
          Effect.gen(function* () {
            const code = yield* runStill(args).pipe(
              Effect.mapError(
                (e) =>
                  new FFmpegError({
                    cause: e,
                    message: `Failed to capture frame at ${frame.time}s: ${e.message}`,
                  })
              )
            );
            if (code !== 0) {
              return yield* new FFmpegError({
                cause: null,
                message: `Failed to capture frame at ${frame.time}s, exit code: ${code}`,
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
        captureFrameAtTime,
        runStill,
      };
    }),
    dependencies: [NodeContext.layer, FfmpegPermitsService.Default],
  }
) {}
