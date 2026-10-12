import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Config, Data, Effect, Option, Stream } from "effect";
import crypto from "node:crypto";
import path from "node:path";
import { homedir, tmpdir } from "os";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { findSilenceInVideo } from "./silence-detection";
import { VideoEditorLoggerService } from "./video-editor-logger-service";
import type { SilenceLength } from "@/silence-detection-constants";
import { clipFrameFfmpegArgs, type ClipFrame } from "@/packages/clip-source";

export type PauseType = "none" | "long";

const AUTO_EDITED_VIDEO_FINAL_END_PADDING = 0.5;

const FUSCRIPT_LOCATION =
  "/mnt/d/Program Files/Blackmagic Design/DaVinci Resolve/fuscript.exe";

class CouldNotRunDavinciResolveScriptError extends Data.TaggedError(
  "CouldNotRunDavinciResolveScriptError"
)<{
  cause: unknown;
  message: string;
}> {}

export class VideoProcessingService extends Effect.Service<VideoProcessingService>()(
  "VideoProcessingService",
  {
    effect: Effect.gen(function* () {
      const effectFs = yield* FileSystem.FileSystem;
      const ffmpegCommands = yield* FFmpegCommandsService;

      const getLatestOBSVideoClips = Effect.fn("getLatestOBSVideoClips")(
        function* (opts: {
          filePath: string | undefined;
          startTime: number | undefined;
          silenceLength?: SilenceLength;
        }) {
          if (!opts.filePath) {
            // Without a file path, fall back to the most recent OBS recording.
            const obsDir = yield* Config.string("OBS_RECORDING_DIR").pipe(
              Effect.orElseSucceed(() => path.join(homedir(), "Videos"))
            );

            // Find the most recent .mp4 file
            const files = yield* effectFs.readDirectory(obsDir);
            const mp4Files = files.filter((f) => f.endsWith(".mp4"));
            if (mp4Files.length === 0) {
              return {
                clips: [] as {
                  inputVideo: string;
                  startTime: number;
                  endTime: number;
                }[],
              };
            }

            // Sort by modification time (most recent first)
            const filesWithStats = yield* Effect.forEach(mp4Files, (file) =>
              Effect.gen(function* () {
                const fullPath = path.join(obsDir, file);
                const stat = yield* effectFs.stat(fullPath);
                const mtimeMs = Option.match(stat.mtime, {
                  onNone: () => 0,
                  onSome: (d) => d.getTime(),
                });
                return { file: fullPath, mtimeMs };
              })
            );
            filesWithStats.sort((a, b) => b.mtimeMs - a.mtimeMs);

            const latestFile = filesWithStats[0]!.file;
            return yield* findSilenceInVideo(ffmpegCommands, latestFile, {
              startTime: opts.startTime,
              silenceLength: opts.silenceLength,
            });
          }

          return yield* findSilenceInVideo(ffmpegCommands, opts.filePath, {
            startTime: opts.startTime,
            silenceLength: opts.silenceLength,
          });
        }
      );

      /**
       * Renders a still to a cached PNG. An OBS Clip's frame is cached under
       * its file and time as it always was; a composite under the whole frame.
       */
      const renderStill = Effect.fn("renderStill")(function* (
        frame: ClipFrame,
        cacheKeyPrefix: string
      ) {
        const seek = frame.time.toFixed(2);
        const inputHash = crypto
          .createHash("sha256")
          .update(
            cacheKeyPrefix +
              (frame.kind === "footage"
                ? frame.inputVideo + seek
                : JSON.stringify({ ...frame, time: seek }))
          )
          .digest("hex")
          .slice(0, 10);

        const folder = path.join(tmpdir(), "tt-cli-images");
        yield* effectFs.makeDirectory(folder, { recursive: true });

        const outputFile = path.join(folder, `${inputHash}.png`);

        const outputFileExists = yield* effectFs.exists(outputFile);

        if (outputFileExists) {
          return outputFile;
        }

        const command = Command.make(
          "ffmpeg",
          ...clipFrameFfmpegArgs(frame, { seek }),
          "-frames:v",
          "1",
          outputFile
        );
        yield* Command.exitCode(command);

        return outputFile;
      });

      const getLastFrame = (frame: ClipFrame) => renderStill(frame, "");

      const getFirstFrame = (frame: ClipFrame) => renderStill(frame, "first-");

      /**
       * Serialize clips into the format expected by the clip-and-append.lua script.
       */
      const serializeClipsForAppendScript = (
        clips: {
          startFrame: number;
          endFrame: number;
          videoIndex: number;
          trackIndex: number;
        }[]
      ) => {
        return clips
          .map(
            (clip) =>
              `${clip.startFrame}___${clip.endFrame}___${clip.videoIndex}___${clip.trackIndex}`
          )
          .join(":::");
      };

      /**
       * Run a DaVinci Resolve Lua script via fuscript.exe.
       */
      const runDavinciResolveScript = Effect.fn("runDavinciResolveScript")(
        function* (script: string, env: Record<string, string>) {
          const scriptPath = path.resolve(
            import.meta.dirname,
            "../../resources/resolve",
            script
          );

          // Convert to Windows UNC path for fuscript
          const windowsScriptPath = scriptPath.replace(
            /^\/home\/(\w+)/,
            (_, user) =>
              `\\\\\\\\wsl.localhost\\\\Ubuntu-24.04\\\\home\\\\${user}`
          );

          const command = Command.make(
            FUSCRIPT_LOCATION,
            "-q",
            windowsScriptPath
          ).pipe(Command.env(env));

          return yield* Effect.scoped(
            Effect.gen(function* () {
              const process = yield* Command.start(command).pipe(
                Effect.mapError(
                  (e) =>
                    new CouldNotRunDavinciResolveScriptError({
                      cause: e,
                      message: `Failed to run DaVinci Resolve script: ${e.message}`,
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
              yield* process.exitCode.pipe(Effect.ignore);

              return { stdout, stderr };
            })
          );
        }
      );

      const sendClipsToDavinciResolve = Effect.fn("sendClipsToDavinciResolve")(
        function* (opts: {
          timelineName: string;
          clips: {
            inputVideo: string;
            startTime: number;
            duration: number;
          }[];
        }) {
          const uniqueInputVideos = [
            ...new Set(opts.clips.map((clip) => clip.inputVideo)),
          ];

          const inputVideosMap = uniqueInputVideos.reduce(
            (acc, video, index) => {
              acc[video] = index;
              return acc;
            },
            {} as Record<string, number>
          );

          const firstInputVideo = uniqueInputVideos[0];
          if (!firstInputVideo) {
            return "";
          }

          const fps = yield* ffmpegCommands.getFPS(firstInputVideo);

          const serializedClips = serializeClipsForAppendScript(
            opts.clips.map((clip, index, array) => {
              const isLastClip = index === array.length - 1;
              const endPadding = isLastClip
                ? AUTO_EDITED_VIDEO_FINAL_END_PADDING
                : 0;
              return {
                startFrame: Math.floor(clip.startTime * fps),
                endFrame: Math.ceil(
                  (clip.startTime + clip.duration + endPadding) * fps
                ),
                videoIndex: inputVideosMap[clip.inputVideo]!,
                trackIndex: 1,
              };
            })
          );

          const result = yield* runDavinciResolveScript("clip-and-append.lua", {
            NEW_TIMELINE_NAME: opts.timelineName,
            INPUT_VIDEOS: uniqueInputVideos.join(":::"),
            CLIPS_TO_APPEND: serializedClips,
            WSLENV: "INPUT_VIDEOS/p:CLIPS_TO_APPEND:NEW_TIMELINE_NAME",
          });

          return result.stdout;
        }
      );

      return {
        getLatestOBSVideoClips,
        /**
         * The container duration of a finished file, in seconds.
         *
         * The export step needs this for a file it did not just render — the
         * export it finds already on disk and would otherwise skip. It has to
         * come through this service rather than from ffprobe directly, because
         * this is the seam a Publish test replaces.
         */
        getVideoDurationInSeconds: ffmpegCommands.getVideoDurationInSeconds,
        getLastFrame,
        getFirstFrame,
        sendClipsToDavinciResolve,
      };
    }),
    dependencies: [
      NodeContext.layer,
      FFmpegCommandsService.Default,
      VideoEditorLoggerService.Default,
    ],
  }
) {}
