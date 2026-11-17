import { Command } from "@effect/platform";
// The subpath, not the barrel: the barrel loads undici into every `cvm` call
// (`cvm footage frame` reaches this module).
import * as NodeContext from "@effect/platform-node/NodeContext";
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

/** `exe args…`, or `nice -n 19 exe args…`: behind the rest of WSL. */
const argv = (
  exe: string,
  args: readonly string[],
  lowPriority: boolean
): [string, ...string[]] =>
  lowPriority ? ["nice", "-n", "19", exe, ...args] : [exe, ...args];

/**
 * Run a process to its end, draining stdout and stderr together (a pipe
 * nobody reads fills and blocks the writer), and answer both with its exit
 * code.
 */
const runCollected = (argvParts: readonly [string, ...string[]]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const [file, ...rest] = argvParts;
      const child = yield* Command.start(Command.make(file, ...rest));
      const [stdout, stderr] = yield* Effect.all(
        [
          child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          child.stderr.pipe(Stream.decodeText(), Stream.mkString),
        ],
        { concurrency: 2 }
      );
      return { code: Number(yield* child.exitCode), stdout, stderr };
    })
  );

/** ebur128's summary: `Integrated loudness:` then `I: -23.0 LUFS`. */
const INTEGRATED_LOUDNESS =
  /Integrated loudness:\s*I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/;

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

        // ffmpeg exits non-zero with -f null, but we still get the output:
        // silencedetect info is written to stderr.
        const run = yield* cpuSemaphore.withPermits(1)(
          runCollected(argv("ffmpeg", args, false))
        );
        return run.stdout + run.stderr;
      });

      /**
       * The integrated loudness (LUFS, EBU R128) of a file's first sound
       * stream, the one a `<video>` plays; null when it has no sound at all.
       * At `nice -n 19`: the preview-loudness Job runs it in the Sidecar.
       */
      const measureIntegratedLoudness = Effect.fn("measureIntegratedLoudness")(
        function* (file: string) {
          const probe = yield* cpuSemaphore.withPermits(1)(
            runCollected(
              argv(
                "ffprobe",
                [
                  "-v",
                  "error",
                  "-select_streams",
                  "a:0",
                  "-show_entries",
                  "stream=index",
                  "-of",
                  "csv=p=0",
                  file,
                ],
                true
              )
            )
          );
          if (probe.code !== 0) {
            return yield* new FFmpegError({
              cause: null,
              message: `ffprobe could not read ${file}: ${probe.stderr.trim()}`,
            });
          }
          if (probe.stdout.trim() === "") return null;
          const run = yield* cpuSemaphore.withPermits(1)(
            runCollected(
              argv(
                "ffmpeg",
                [
                  "-hide_banner",
                  "-nostats",
                  "-nostdin",
                  "-i",
                  file,
                  "-map",
                  "0:a:0",
                  "-af",
                  "ebur128=framelog=quiet",
                  "-f",
                  "null",
                  "-",
                ],
                true
              )
            )
          );
          const match = INTEGRATED_LOUDNESS.exec(run.stderr);
          if (run.code !== 0 || !match) {
            return yield* new FFmpegError({
              cause: null,
              message: `ffmpeg could not measure the loudness of ${file} (exit ${run.code}): ${run.stderr.slice(-2000)}`,
            });
          }
          return Number(match[1]);
        }
      );

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
            const [file, ...rest] = argv("ffmpeg", args, lowPriority);
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

      /**
       * A Choose Screenshot capture, at its source's own size and never
       * scaled: a screen frame (No face), a composite (With face, 1920x1080
       * Landscape) or a Footage frame. The route writes a lossless PNG, so
       * there is no quality setting to raise.
       */
      const captureFrameAtTime = Effect.fn("captureFrameAtTime")(function* (
        frame: ClipFrame,
        outputPath: string
      ) {
        const args = [
          "-y",
          "-hide_banner",
          ...clipFrameFfmpegArgs(frame, { seek: String(frame.time) }),
          "-vframes",
          "1",
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
        measureIntegratedLoudness,
        getFPS,
        getVideoDurationInSeconds,
        captureFrameAtTime,
        runStill,
      };
    }),
    dependencies: [NodeContext.layer, FfmpegPermitsService.Default],
  }
) {}
