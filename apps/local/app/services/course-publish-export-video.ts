import path from "node:path";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VideoProcessingService } from "./video-processing-service";
import {
  computeExportHash,
  resolveExportPath as resolveExportPathPure,
  toExportClips,
} from "./export-hash";
import {
  ensureExportDigest,
  ensureExportDuration,
  sidecarPath,
} from "./export-sha256-sidecar";
import {
  expectedExportDurationInSeconds,
  isExportUnacceptablyShort,
  paddedClipDurationsInSeconds,
} from "./export-duration-check";
import { resolveVideoFormat } from "@/features/videos/video-format";
import { OverlayRenderCacheService } from "./overlay-render-cache.server";
import {
  placeOverlaysOnTimeline,
  withRenderedContent,
} from "./overlay-compositing";
import { ExportError } from "./course-publish-errors";
import { formatFailureCause } from "./format-failure-cause";
import { VideoEditorLoggerService } from "./video-editor-logger-service";

/**
 * Who the export belongs to: a Course names the file and gives the export
 * garbage collector something to sweep, a standalone Video is its own
 * namespace.
 */
export type ExportOwner =
  { kind: "course"; courseId: string } | { kind: "standalone" };

/** The two stages an export reports progress from. */
export type ExportStage = "concatenating-clips" | "normalizing-audio";

/**
 * Render one Video to the address its own contents ask for — the whole of the
 * export step, from "is it already there and sound?" to the digest written
 * beside the finished file.
 *
 * It lives apart from `CoursePublishService` because it is the one part of a
 * Publish that touches ffmpeg and the finished-videos directory, and because
 * the Overlay compositing pass has to slot into it.
 */
export const exportVideoToItsAddress = Effect.fn("exportVideoToItsAddress")(
  function* (opts: {
    videoId: string;
    finishedVideosDirectory: string;
    onStage?: (stage: ExportStage) => void;
    onProgress?: (info: { stage: ExportStage; percent: number }) => void;
  }) {
    const { videoId, onStage, onProgress } = opts;
    const FINISHED_VIDEOS_DIRECTORY = opts.finishedVideosDirectory;
    const videoOps = yield* VideoOperationsService;
    const videoProcessing = yield* VideoProcessingService;
    const overlayRenderCache = yield* OverlayRenderCacheService;
    const videoEditorLogger = yield* VideoEditorLoggerService;
    const effectFs = yield* FileSystem.FileSystem;

    /** Deleting a file we are replacing is never a reason to fail. */
    const removeQuietly = (filePath: string) =>
      effectFs.remove(filePath).pipe(Effect.catchAll(() => Effect.void));

    /**
     * Write why a stage failed into the Video's own log, beside the
     * `cli-output` of whichever passes did run.
     *
     * Best-effort, exactly like `makeFfmpegLogger`: a log write that fails
     * must never replace the export failure it was called to explain.
     */
    const recordStageFailure =
      (stage: string) =>
      (cause: unknown): Effect.Effect<void> =>
        videoEditorLogger
          .log(videoId, {
            type: "export-stage-failed",
            videoId,
            stage,
            message: cause instanceof Error ? cause.message : String(cause),
            cause: formatFailureCause(cause),
          })
          .pipe(Effect.catchAll(() => Effect.void));

    const video = yield* videoOps.getVideoWithClipsById(videoId);
    const courseId = video.lesson?.section.repoVersion.repo.id;
    const owner: ExportOwner = courseId
      ? { kind: "course", courseId }
      : { kind: "standalone" };
    const namespace = courseId ?? videoId;

    const exportClips = toExportClips(video.clips);
    const hash = computeExportHash(exportClips, video.format);
    if (!hash) {
      return yield* Effect.fail(
        new ExportError({ message: "Video has no clips to export" })
      );
    }

    const targetPath = resolveExportPathPure(
      FINISHED_VIDEOS_DIRECTORY,
      namespace,
      hash
    );

    // What the Clips ask for, and what the renderer is told to make: one
    // list of padded durations, used for both, so the file asked for and
    // the file checked for cannot differ.
    const clipDurations = paddedClipDurationsInSeconds(video.clips);
    const renderClips = video.clips.map((clip, index) => ({
      inputVideo: clip.videoFilename,
      startTime: clip.sourceStartTime,
      duration: clipDurations[index]!.duration,
      pauseType: clipDurations[index]!.pauseType,
      zoomType: clip.zoomType,
    }));

    const expectedDurationInSeconds =
      expectedExportDurationInSeconds(clipDurations);

    // An export already at its address is skipped, but only after it has
    // answered for its duration. An export truncated before this check
    // existed would otherwise be skipped for ever and shipped every time;
    // a short one is removed with its sidecar and falls through to be
    // re-encoded, which repairs the backlog without touching the exports
    // that are sound.
    if (yield* effectFs.exists(targetPath)) {
      const durationInSeconds = yield* ensureExportDuration(
        effectFs,
        targetPath,
        // An export that cannot be probed at all is no more trustworthy
        // than one measured short, and is refused the same way.
        videoProcessing
          .getVideoDurationInSeconds(targetPath)
          .pipe(Effect.orElseSucceed(() => Number.NaN))
      );
      if (
        !isExportUnacceptablyShort({
          expectedDurationInSeconds,
          actualDurationInSeconds: durationInSeconds,
        })
      ) {
        return { targetPath, owner };
      }
      yield* removeQuietly(targetPath);
      yield* removeQuietly(sidecarPath(targetPath));
    }

    // Where every Overlay on this Video lands on the flattened timeline. The
    // Clips are in playback order with the archived ones already gone, so a
    // Clip's start is the sum of what the Clips before it contribute.
    const placedOverlays = placeOverlaysOnTimeline(video.clips, clipDurations);

    // Export via ffmpeg → writes to {videoId}.mp4
    const rendered = yield* videoProcessing.exportVideoClips({
      videoId,
      format: resolveVideoFormat(video.format),
      clips: renderClips,
      onStageChange: onStage,
      onProgress,
    });

    const videoIdPath = path.join(FINISHED_VIDEOS_DIRECTORY, `${videoId}.mp4`);

    // Check the export against its own Clips BEFORE the rename. A file
    // that never reaches its content-addressed path never becomes an
    // Exported Video, so nothing downstream can address it and the next
    // attempt re-encodes rather than skipping.
    if (
      isExportUnacceptablyShort({
        expectedDurationInSeconds,
        actualDurationInSeconds: rendered.durationInSeconds,
      })
    ) {
      yield* removeQuietly(videoIdPath);
      return yield* Effect.fail(
        new ExportError({
          message: `Export for video "${video.title}" (${videoId}) is short: its clips ask for ${expectedDurationInSeconds.toFixed(1)}s but the file is ${rendered.durationInSeconds.toFixed(1)}s`,
        })
      );
    }

    // Composite the Definition Cards on, once the export is known to be a
    // whole one. A Video with no Overlays never runs this pass at all, so its
    // bytes are exactly what they were before Overlays existed — which is
    // also what keeps its Byte Hash, and so its place in Dropbox, unmoved.
    if (placedOverlays.length > 0) {
      yield* Effect.gen(function* () {
        // Every Overlay's content is rendered (or found already rendered)
        // before ffmpeg is asked for anything, so one failed render costs no
        // encode.
        const renderedOverlays = yield* Effect.forEach(
          placedOverlays,
          (placed) =>
            overlayRenderCache
              .renderOverlay({
                courseId: namespace,
                content: placed.content,
              })
              .pipe(
                Effect.map((overlayPath) =>
                  withRenderedContent(placed, overlayPath)
                )
              )
          // The render stage is named apart from the compositing stage on
          // purpose: the two fail for unrelated reasons — a Chromium render
          // versus an ffmpeg filtergraph — and the log should say which one
          // the export never got past. It is named for Overlays and not for
          // Definition Cards because every Overlay Kind renders through it.
        ).pipe(Effect.tapError(recordStageFailure("export:render-overlays")));

        yield* videoProcessing
          .compositeOverlaysOntoExport({
            videoId,
            videoPath: videoIdPath,
            overlays: renderedOverlays,
            totalDurationSeconds: expectedDurationInSeconds,
          })
          .pipe(
            Effect.tapError(recordStageFailure("export:composite-overlays"))
          );
      }).pipe(
        // Content that will not render, and an ffmpeg pass that will not run,
        // are both simply "this Video did not export": the file never reaches
        // its address, so nothing downstream can ship it and the next attempt
        // starts over.
        //
        // The cause is written to the Video's own log ABOVE, before this
        // `mapError` throws it away. `Effect.logError` alone was not enough:
        // it goes to the app's stdout, while everyone diagnosing a failed
        // export reads `.data/logs/{videoId}.log`, and the message that
        // survives this `mapError` names only the Video.
        Effect.tapError((cause) =>
          Effect.logError("Overlay compositing failed", cause)
        ),
        Effect.mapError(
          () =>
            new ExportError({
              message: `Failed to composite Overlays onto video "${video.title}" (${videoId})`,
            })
        ),
        Effect.tapError(() => removeQuietly(videoIdPath))
      );
    }

    // Move from {videoId}.mp4 to content-addressed path
    yield* effectFs.rename(videoIdPath, targetPath);

    // Digest it now, while it is the newest thing on the disk. A later
    // Publish that copies this Video inside Dropbox rather than uploading
    // it never streams the bytes, so this is the only moment they are
    // guaranteed to pass through our hands.
    yield* ensureExportDigest(effectFs, targetPath, rendered.durationInSeconds);

    return { targetPath, owner };
  }
);
