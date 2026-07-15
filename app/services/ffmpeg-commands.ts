import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Data, Effect, Stream } from "effect";
import crypto from "node:crypto";
import path from "node:path";
import { tmpdir } from "os";

const GPU_PERMITS = 6;
const CPU_PERMITS = 12;

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

      const createAndConcatenateVideoClipsSinglePass = Effect.fn(
        "createAndConcatenateVideoClipsSinglePass"
      )(function* (
        clips: readonly {
          inputVideo: string;
          startTime: number;
          duration: number;
          pauseType: "none" | "long";
        }[]
      ) {
        const LONG_PAUSE_DURATION = 0.18;

        const outputDir = path.join(tmpdir(), "video-processing");
        yield* fs.makeDirectory(outputDir, { recursive: true });

        const outputHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(clips) + Date.now())
          .digest("hex")
          .slice(0, 12);
        const outputFile = path.join(outputDir, `${outputHash}.mp4`);

        // Build input args
        const inputArgs: string[] = [];
        for (const clip of clips) {
          const duration =
            clip.pauseType === "long"
              ? clip.duration + LONG_PAUSE_DURATION
              : clip.duration;
          inputArgs.push(
            "-ss",
            clip.startTime.toString(),
            "-t",
            duration.toString(),
            "-i",
            clip.inputVideo
          );
        }

        // Build filter complex. Normalize every input to the vertical 1080x1920
        // frame (and stereo audio) so the concat filter — which requires all
        // inputs to share dimensions/SAR/channel layout — accepts odd effect
        // clips (e.g. white noise at 854x480 mono). The target MUST stay
        // portrait: these are 9:16 shorts and the subtitle overlay is 1080x1920,
        // so scaling to landscape here produced a landscape export with the
        // portrait overlay pinned top-left.
        const filterParts: string[] = [];
        const concatInputs: string[] = [];
        for (let i = 0; i < clips.length; i++) {
          filterParts.push(
            `[${i}:v]setpts=PTS-STARTPTS,scale=1080:1920,setsar=1[v${i}]`,
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
          outputFile,
        ];

        yield* gpuSemaphore.withPermits(1)(
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
                    message: `Failed to create concatenated video: ${e.message}`,
                  })
              )
            );
            if (code !== 0) {
              yield* new FFmpegError({
                cause: null,
                message: `Failed to create concatenated video, exit code: ${code}`,
              });
            }
          })
        );

        return outputFile;
      });

      const normalizeAudio = Effect.fn("normalizeAudio")(function* (
        inputVideo: string
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
          outputFile,
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
                    message: `Failed to normalize audio: ${e.message}`,
                  })
              )
            );
            if (code !== 0) {
              yield* new FFmpegError({
                cause: null,
                message: `Failed to normalize audio, exit code: ${code}`,
              });
            }
          })
        );

        return outputFile;
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
        createAndConcatenateVideoClipsSinglePass,
        normalizeAudio,
        captureFrameAtTime,
      };
    }),
    dependencies: [NodeContext.layer],
  }
) {}
