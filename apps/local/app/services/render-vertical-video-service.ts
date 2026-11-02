import {
  clipComposite,
  clipFfmpegInput,
  clipSource,
} from "@/packages/clip-source";
import { clipExportDurationInSeconds } from "./export-duration-check";
import { Command, FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Cause, Data, Effect, Stream } from "effect";
import path from "node:path";
import { tmpdir } from "os";
import crypto from "node:crypto";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { FFmpegEncodeService } from "./ffmpeg-encode-commands";
import { FFmpegCommandsService } from "./ffmpeg-commands";
import { VideoEditorLoggerService } from "./video-editor-logger-service";
import { makeFfmpegLogger } from "./ffmpeg-video-logger";
import { VIDEO_FORMAT_DIMENSIONS } from "@/features/videos/video-format";
import { overlayRendererBinPath } from "./overlay-renderer-bin";
import { loadShortSubtitles } from "./short-subtitles";
import { verticalOverlayProps } from "./vertical-overlay-props";
import { removeBestEffort } from "@/services/remove-best-effort";
import { formatFailureCause } from "./format-failure-cause";
import { SidecarContext } from "./sidecar-context";
import { storageRootsConfig } from "./storage-roots";
import { resolveClipSourceFiles } from "./clip-source-files.server";
import { STORAGE_FOLDERS, writeFolder } from "@/packages/storage";

export type RenderVerticalStage =
  "concatenating-clips" | "rendering-overlay" | "compositing";

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
      const clipOps = yield* ClipOperationsService;
      const ffmpegCommands = yield* FFmpegCommandsService;
      const ffmpegEncode = yield* FFmpegEncodeService;
      const effectFs = yield* FileSystem.FileSystem;
      const videoEditorLogger = yield* VideoEditorLoggerService;

      const renderVerticalVideo = Effect.fn("renderVerticalVideo")(
        function* (opts: {
          videoId: string;
          onStageChange?: (stage: RenderVerticalStage) => void;
        }) {
          // A vertical render is a Job: only the Sidecar runs it, never a
          // request a browser tab keeps alive (sidecar-context.ts).
          yield* SidecarContext;
          // The stage the render is in, so a failure can say where it broke.
          let stage: RenderVerticalStage | "loading-video" = "loading-video";
          const enterStage = (next: RenderVerticalStage) => {
            stage = next;
            opts.onStageChange?.(next);
          };

          // A failed render's message used to reach only the browser (the SSE
          // `error` event, shown as a toast): the server log and
          // `.data/logs/{videoId}.log` showed the last ffmpeg pass and then
          // nothing, which is how a broken overlay renderer went unseen. Both
          // now get the failure. `tapErrorCause`, not `tapError`, so a defect
          // (a throw inside a generator) is recorded too.
          const recordFailure = (cause: Cause.Cause<unknown>) => {
            // A client that disconnects interrupts the render; that is not a
            // failure worth a log line.
            if (Cause.isInterruptedOnly(cause)) return Effect.void;
            const failure = Cause.squash(cause);
            return Effect.logError(
              `Vertical short render failed at stage "${stage}" for video ${opts.videoId}`,
              cause
            ).pipe(
              Effect.zipRight(
                videoEditorLogger.log(opts.videoId, {
                  type: "export-stage-failed",
                  videoId: opts.videoId,
                  stage: `short:${stage}`,
                  message:
                    failure instanceof Error
                      ? failure.message
                      : String(failure),
                  cause: formatFailureCause(failure),
                })
              ),
              // Best-effort: logging must never replace the failure it explains.
              Effect.catchAllDefect(() => Effect.void)
            );
          };

          return yield* Effect.gen(function* () {
            const storageRoots = yield* storageRootsConfig;
            const FINISHED_VIDEOS_DIRECTORY = writeFolder(
              storageRoots,
              STORAGE_FOLDERS.finishedVideos
            );

            const video = yield* videoOps.getVideoWithClipsById(opts.videoId);

            if (video.clips.length === 0) {
              return yield* new RenderVerticalError({
                cause: null,
                message: "Video has no clips to export",
              });
            }

            // Every ffmpeg invocation for this render is teed into
            // `.data/logs/{videoId}.log` (the "cli-output" event, on both
            // success and failure) — see the matching comment in
            // video-processing-service.ts's exportVideoClips.
            const logCliOutput = (
              stage: "concat" | "normalize-audio" | "composite-overlay"
            ) =>
              makeFfmpegLogger(
                videoEditorLogger,
                opts.videoId,
                `short:${stage}`
              );

            // Step 1: Concatenate clips → temp file (not the final output path,
            // since the composite step will write the final .mp4)
            enterStage("concatenating-clips");
            const renderClips = yield* Effect.forEach(video.clips, (clip) =>
              Effect.gen(function* () {
                // Its files found on a Storage Root, or "Footage not found
                // (E: offline?)".
                // Every Clip drawn in the Short layout: a stream's Landscape
                // session too, never its own picture squashed.
                const source = yield* resolveClipSourceFiles(
                  clipSource(clip, { videoFormat: "short" }),
                  storageRoots
                ).pipe(
                  Effect.mapError(
                    (error) =>
                      new RenderVerticalError({
                        cause: error,
                        message: error.message,
                      })
                  )
                );
                const input = {
                  ...clipFfmpegInput(source),
                  pauseType: clip.pauseType as "none" | "long",
                  zoomType: clip.zoomType,
                };
                const duration = clipExportDurationInSeconds(input);
                return {
                  ...input,
                  id: clip.id,
                  text: clip.text,
                  // A CVM-recorder Clip's picture is drawn from its Recording
                  // Session, over everything it outputs (long Pause included).
                  composite: clipComposite(source, {
                    durationSeconds: duration,
                  }),
                };
              })
            );
            // The vertical renderer always produces a 9:16 short — the Remotion
            // caption overlay below is rendered at 1080x1920 to match.
            // A CVM-recorder Clip's composite is drawn on the Short layout's
            // own 1080x1920 canvas, and a single Footage file covers it
            // centre-cropped, so nothing is stretched.
            const dimensions = VIDEO_FORMAT_DIMENSIONS.short;
            const concatExtras = { onLog: logCliOutput("concat") };
            // As the export does: a Video with any CVM-recorder Clip is
            // rendered Clip by Clip, each one's composite on its own.
            const rawConcatenatedPath = renderClips.some((c) => c.composite)
              ? yield* ffmpegEncode.concatenateClipSegments(
                  renderClips.map((clip) => ({
                    ...clip,
                    duration: clipExportDurationInSeconds(clip),
                  })),
                  dimensions,
                  concatExtras
                )
              : yield* ffmpegEncode.createAndConcatenateVideoClipsSinglePass(
                  renderClips.map(
                    ({ composite: _, id: _id, text: _text, ...clip }) => clip
                  ),
                  dimensions,
                  concatExtras
                );
            const concatenatedPath = yield* ffmpegEncode.normalizeAudio(
              rawConcatenatedPath,
              { onLog: logCliOutput("normalize-audio") }
            );

            // Clean up raw concatenated file
            yield* removeBestEffort(effectFs, rawConcatenatedPath);

            // Step 2: The subtitles, from the Clips' own text and Transcript
            // Words (#2172) — never a second transcription. Each Clip takes the
            // seconds the concat was asked for, so the two timelines match.
            const fps = yield* ffmpegCommands.getFPS(concatenatedPath);
            const { subtitles, durationInFrames } = yield* loadShortSubtitles(
              renderClips.map((clip) => ({
                id: clip.id,
                text: clip.text,
                durationSeconds: clipExportDurationInSeconds(clip),
              })),
              fps
            ).pipe(Effect.provideService(ClipOperationsService, clipOps));

            // Step 3: Render Remotion overlay
            enterStage("rendering-overlay");
            const overlayDir = path.join(tmpdir(), "cvm-overlay-render");
            yield* effectFs.makeDirectory(overlayDir, { recursive: true });
            const overlayHash = crypto
              .createHash("sha256")
              .update(opts.videoId + Date.now())
              .digest("hex")
              .slice(0, 12);
            const overlayPath = path.join(overlayDir, `${overlayHash}.mov`);

            // The captions and the Short's Chat Cards (the only
            // Overlays a Short draws), placed on the concat's own durations.
            const propsJson = JSON.stringify(
              verticalOverlayProps({
                fps,
                durationInFrames,
                subtitles,
                clips: video.clips,
                clipDurations: renderClips,
              })
            );

            yield* renderOverlay(effectFs, propsJson, overlayPath);

            // Step 4: Composite overlay onto concatenated video
            enterStage("compositing");
            const outputPath = path.join(
              FINISHED_VIDEOS_DIRECTORY,
              `${opts.videoId}.mp4`
            );
            yield* effectFs.makeDirectory(path.dirname(outputPath), {
              recursive: true,
            });

            yield* ffmpegEncode.compositeOverlay(
              concatenatedPath,
              overlayPath,
              outputPath,
              logCliOutput("composite-overlay")
            );

            // Clean up intermediate files
            yield* removeBestEffort(effectFs, overlayPath);
            yield* removeBestEffort(effectFs, concatenatedPath);

            return outputPath;
          }).pipe(Effect.tapErrorCause(recordFailure));
        }
      );

      return { renderVerticalVideo };
    }),
    dependencies: [
      NodeContext.layer,
      FFmpegCommandsService.Default,
      FFmpegEncodeService.Default,
      VideoEditorLoggerService.Default,
    ],
  }
) {}

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

    const binPath = yield* Effect.try({
      try: () => overlayRendererBinPath(),
      catch: (e) =>
        new RenderVerticalError({
          cause: e,
          message: `Could not locate the overlay renderer: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });

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
          return yield* new RenderVerticalError({
            cause: null,
            message: `Overlay renderer exited with code ${exitCode}: ${stderr}`,
          });
        }

        return stdout;
      })
    );

    // Clean up props file
    yield* removeBestEffort(effectFs, propsFile);

    return result;
  });
}
