import { needsClipSegments } from "./clip-segment-args";
import { clipExportDurationInSeconds } from "./export-duration-check";
import { FileSystem } from "@effect/platform";
import { NodeContext } from "@effect/platform-node";
import { Cause, Data, Effect } from "effect";
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
import { shortOverlayProps, shortRenderClips } from "./short-render-clips";
import { ShortOverlayRendererService } from "./short-overlay-renderer";
import { removeBestEffort } from "@/services/remove-best-effort";
import { formatFailureCause } from "./format-failure-cause";
import { SidecarContext } from "./sidecar-context";
import { storageRootsConfig } from "./storage-roots";
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
      const overlayRenderer = yield* ShortOverlayRendererService;

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
            const renderClips = yield* shortRenderClips(
              video.clips,
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
            // The vertical renderer always produces a 9:16 short — the Remotion
            // caption overlay below is rendered at 1080x1920 to match.
            // A CVM-recorder Clip's composite is drawn on the Short layout's
            // own 1080x1920 canvas, and a single Footage file covers it
            // centre-cropped, so nothing is stretched.
            const dimensions = VIDEO_FORMAT_DIMENSIONS.short;
            const concatExtras = { onLog: logCliOutput("concat") };
            // As the export does: a Video with any CVM-recorder Clip is
            // rendered Clip by Clip, each one's composite on its own.
            const rawConcatenatedPath = needsClipSegments(renderClips)
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
                    ({
                      composite: _,
                      layers: _layers,
                      id: _id,
                      text: _text,
                      ...clip
                    }) => clip
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

            // Step 2: The overlay's props, on the concat's own frame rate.
            const fps = yield* ffmpegCommands.getFPS(concatenatedPath);
            const props = yield* shortOverlayProps({
              renderClips,
              clips: video.clips,
              fps,
            }).pipe(Effect.provideService(ClipOperationsService, clipOps));

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
            yield* overlayRenderer.renderVideo(props, overlayPath).pipe(
              Effect.catchTag(
                "OverlayRendererError",
                (error) =>
                  new RenderVerticalError({
                    cause: error.cause,
                    message: error.message,
                  })
              )
            );

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
      ShortOverlayRendererService.Default,
    ],
  }
) {}
