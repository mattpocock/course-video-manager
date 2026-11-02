import {
  clipComposite,
  clipFfmpegInput,
  clipLayers,
  clipSource,
} from "@/packages/clip-source";
import path from "node:path";
import { Cause, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VideoExportService } from "./video-export-service";
import {
  computeExportHash,
  exportFilename,
  toExportClips,
} from "./export-hash";
import {
  STORAGE_FOLDERS,
  writeFolder,
  type StorageRoots,
} from "@/packages/storage";
import {
  assertUnderFinishedVideos,
  locateExportedVideo,
} from "./finished-videos.server";
import { resolveClipSourceFiles } from "./clip-source-files.server";
import { resolveStoragePath } from "@/packages/storage/server";
import {
  ensureExportDigest,
  ensureExportDuration,
  sidecarPath,
} from "./export-sha256-sidecar";
import {
  clipExportDurationInSeconds,
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
import { failureHeadline, formatFailureCause } from "./format-failure-cause";
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
    /**
     * The Storage Roots: the export is found on any of them, and written to
     * `finished-videos/` on the first.
     */
    storageRoots: StorageRoots;
    onStage?: (stage: ExportStage) => void;
    onProgress?: (info: { stage: ExportStage; percent: number }) => void;
  }) {
    const { videoId, onStage, onProgress } = opts;
    const roots = opts.storageRoots;
    const FINISHED_VIDEOS_DIRECTORY = writeFolder(
      roots,
      STORAGE_FOLDERS.finishedVideos
    );
    const videoOps = yield* VideoOperationsService;
    const videoExport = yield* VideoExportService;
    const overlayRenderCache = yield* OverlayRenderCacheService;
    const videoEditorLogger = yield* VideoEditorLoggerService;
    const effectFs = yield* FileSystem.FileSystem;

    /** Deleting a file we are replacing is never a reason to fail. */
    const removeQuietly = (filePath: string) =>
      Effect.gen(function* () {
        const guarded = yield* assertUnderFinishedVideos(roots, filePath);
        yield* effectFs.remove(guarded);
      }).pipe(
        // A path outside finished-videos/ is never deleted; say so and go on,
        // as the throwing guard this replaced did.
        Effect.catchTag("PathOutsideBaseDirError", (error) =>
          Effect.logWarning(`export: not removing ${filePath}`, error.message)
        ),
        Effect.catchAllDefect(() => Effect.void)
      );

    /**
     * The stage the export is in, so a failure can say where it broke. Named
     * like `cli-output`'s stages (`export:concat`, …) once prefixed.
     */
    let stage:
      | "loading-video"
      | "checking-existing-export"
      | ExportStage
      | "checking-duration"
      | "render-overlays"
      | "composite-overlays"
      | "finalizing" = "loading-video";

    /**
     * Write why the export failed into the Video's own log, beside the
     * `cli-output` of whichever passes did run, and into the server log.
     * Every stage, not only the Overlay ones: a failed ffmpeg pass, a short
     * file or a rename that will not land all used to leave the Video's log
     * ending on the last pass that ran, with no reason.
     *
     * Best-effort, exactly like `makeFfmpegLogger`: a log write that fails
     * must never replace the export failure it was called to explain.
     */
    const recordFailure = (
      cause: Cause.Cause<unknown>
    ): Effect.Effect<void> => {
      // A client that disconnects interrupts the export; that is not a
      // failure worth a log line.
      if (Cause.isInterruptedOnly(cause)) return Effect.void;
      const failure = Cause.squash(cause);
      return Effect.logError(
        `Export failed at stage "${stage}" for video ${videoId}`,
        cause
      ).pipe(
        Effect.zipRight(
          videoEditorLogger.log(videoId, {
            type: "export-stage-failed",
            videoId,
            stage: `export:${stage}`,
            message:
              failure instanceof Error ? failure.message : String(failure),
            cause: formatFailureCause(failure),
          })
        ),
        // The real logger writes with `appendFileSync`, so a full disk is a
        // defect, not a failure: swallow defects, as `makeFfmpegLogger` does.
        Effect.catchAllDefect(() => Effect.void)
      );
    };

    return yield* Effect.gen(function* () {
      const video = yield* videoOps.getVideoWithClipsById(videoId);
      const courseId = video.lesson?.section.repoVersion.repo.id;
      const owner: ExportOwner = courseId
        ? { kind: "course", courseId }
        : { kind: "standalone" };
      const namespace = courseId ?? videoId;

      const exportClips = toExportClips(video.clips);
      const hash = computeExportHash(exportClips, video.format, roots);
      if (!hash) {
        return yield* Effect.fail(
          new ExportError({
            message: "Video has no clips to export",
          })
        );
      }

      // Where the export is, on whichever root has it; where a new one is
      // written (the first root) when none does.
      const filename = exportFilename(namespace, hash);
      const existingPath = yield* locateExportedVideo(roots, filename);
      const targetPath = path.join(FINISHED_VIDEOS_DIRECTORY, filename);

      // What the Clips ask for, and what the renderer is told to make: one
      // list of padded durations, used for both, so the file asked for and
      // the file checked for cannot differ.
      const clipDurations = paddedClipDurationsInSeconds(video.clips);
      const expectedDurationInSeconds =
        expectedExportDurationInSeconds(clipDurations);

      // An export already at its address is skipped, but only after it has
      // answered for its duration. An export truncated before this check
      // existed would otherwise be skipped for ever and shipped every time;
      // a short one is removed with its sidecar and falls through to be
      // re-encoded, which repairs the backlog without touching the exports
      // that are sound.
      stage = "checking-existing-export";
      let shortExportPath: string | null = null;
      if (yield* effectFs.exists(existingPath)) {
        const durationInSeconds = yield* ensureExportDuration(
          effectFs,
          existingPath,
          // An export that cannot be probed at all is no more trustworthy
          // than one measured short, and is refused the same way.
          videoExport
            .getVideoDurationInSeconds(existingPath)
            .pipe(Effect.orElseSucceed(() => Number.NaN))
        );
        if (
          !isExportUnacceptablyShort({
            expectedDurationInSeconds,
            actualDurationInSeconds: durationInSeconds,
          })
        ) {
          return { targetPath: existingPath, owner };
        }
        // Removed only once every Clip's Footage is found (below): Footage
        // on an unplugged drive must never cost the export already there.
        shortExportPath = existingPath;
      }

      // Each Clip's files found on a Storage Root. One that is on none
      // fails the export with "Footage not found (E: offline?)". Looked up
      // only once a sound export has not been found above: an export whose
      // Footage is on an unplugged drive still ships.
      const renderClips = yield* Effect.forEach(video.clips, (clip, index) =>
        Effect.gen(function* () {
          const source = yield* resolveClipSourceFiles(clipSource(clip), roots);
          const input = clipFfmpegInput(source);
          const asked = clipDurations[index]!;
          return {
            ...input,
            duration: asked.duration,
            pauseType: asked.pauseType,
            zoomType: clip.zoomType,
            // Drawn over everything the Clip outputs, long Pause included.
            composite: clipComposite(source, {
              durationSeconds: clipExportDurationInSeconds(asked),
            }),
            layers: clipLayers(source),
          };
        })
      ).pipe(
        Effect.mapError(
          (error) => new ExportError({ message: error.message, cause: error })
        )
      );

      // Where every Overlay on this Video lands on the flattened timeline. The
      // Clips are in playback order with the archived ones already gone, so a
      // Clip's start is the sum of what the Clips before it contribute.
      const placedOverlays = placeOverlaysOnTimeline(
        video.clips,
        clipDurations
      );

      // A B-roll's Imported Footage is an input of the compositing pass, so
      // it is found now, like each Clip's: a file on no root fails the export
      // with "Footage not found (E: offline?)" before anything is encoded.
      const bRollFootage = yield* Effect.forEach(placedOverlays, (placed) =>
        placed.content.kind === "bRoll"
          ? resolveStoragePath(placed.content.footagePath, roots, "Footage")
          : Effect.succeed(null)
      ).pipe(
        Effect.mapError(
          (error) => new ExportError({ message: error.message, cause: error })
        )
      );

      if (shortExportPath !== null) {
        yield* removeQuietly(shortExportPath);
        yield* removeQuietly(sidecarPath(shortExportPath));
      }

      // Export via ffmpeg → writes to {videoId}.mp4
      stage = "concatenating-clips";
      const rendered = yield* videoExport
        .exportVideoClips({
          videoId,
          format: resolveVideoFormat(video.format),
          clips: renderClips,
          onStageChange: (next) => {
            stage = next;
            onStage?.(next);
          },
          onProgress,
        })
        .pipe(
          // ffmpeg stopped reading one Clip's Footage partway and exited 0
          // anyway (Publish Job 43bfe48a: "Cannot allocate memory", 2.9 s of
          // one Clip gone). Say which Clip, so the log points at it rather
          // than at a whole Video that is merely "short".
          Effect.catchTag("FfmpegInputCutShortError", (error) => {
            const clip =
              error.clipIndex === undefined
                ? undefined
                : video.clips[error.clipIndex];
            const which = clip
              ? `Clip ${error.clipIndex! + 1} of ${video.clips.length} (clip ${clip.id}, ${error.inputPath ?? clip.videoFilename} from ${clip.sourceStartTime.toFixed(2)}s to ${clip.sourceEndTime.toFixed(2)}s)`
              : `input #${error.inputIndex}${error.inputPath ? ` (${error.inputPath})` : ""}`;
            return Effect.fail(
              new ExportError({
                message: `Export for video "${video.title}" (${videoId}) is missing the end of ${which}: ffmpeg stopped reading it early ("${error.reason}") but exited 0`,
                cause: error,
              })
            );
          })
        );
      stage = "checking-duration";

      const videoIdPath = yield* assertUnderFinishedVideos(
        roots,
        path.join(FINISHED_VIDEOS_DIRECTORY, `${videoId}.mp4`)
      );

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
          //
          // The render stage is named apart from the compositing stage on
          // purpose: the two fail for unrelated reasons — a Chromium render
          // versus an ffmpeg filtergraph — and the log should say which one
          // the export never got past. It is named for Overlays and not for
          // Definition Cards because every Overlay Kind renders through it.
          stage = "render-overlays";
          // A B-roll is not rendered: the pass reads its Footage directly.
          const renderedOverlays = yield* Effect.forEach(
            placedOverlays,
            (placed, index) =>
              placed.content.kind === "bRoll"
                ? Effect.succeed(
                    withRenderedContent(placed, bRollFootage[index]!)
                  )
                : overlayRenderCache
                    .renderOverlay({
                      courseId: namespace,
                      content: placed.content,
                    })
                    .pipe(
                      Effect.map((overlayPath) =>
                        withRenderedContent(placed, overlayPath)
                      )
                    )
          );

          stage = "composite-overlays";
          yield* videoExport.compositeOverlaysOntoExport({
            videoId,
            videoPath: videoIdPath,
            overlays: renderedOverlays,
            totalDurationSeconds: expectedDurationInSeconds,
          });
        }).pipe(
          // Content that will not render, and an ffmpeg pass that will not run,
          // are both simply "this Video did not export": the file never reaches
          // its address, so nothing downstream can ship it and the next attempt
          // starts over.
          //
          // The message carries the first line of the real cause, because it
          // is what the author's toast shows; the whole cause rides along as
          // `cause`, for the Video's log.
          Effect.mapError(
            (cause) =>
              new ExportError({
                message: `Failed to composite Overlays onto video "${video.title}" (${videoId}): ${failureHeadline(cause) ?? "unknown cause"}`,
                cause,
              })
          ),
          Effect.tapError(() => removeQuietly(videoIdPath))
        );
      }

      // Move from {videoId}.mp4 to content-addressed path
      stage = "finalizing";
      const guardedTargetPath = yield* assertUnderFinishedVideos(
        roots,
        targetPath
      );
      yield* effectFs.rename(videoIdPath, guardedTargetPath);

      // Digest it now, while it is the newest thing on the disk. A later
      // Publish that copies this Video inside Dropbox rather than uploading
      // it never streams the bytes, so this is the only moment they are
      // guaranteed to pass through our hands.
      yield* ensureExportDigest(
        effectFs,
        targetPath,
        rendered.durationInSeconds
      );

      return { targetPath, owner };
    }).pipe(Effect.tapErrorCause(recordFailure));
  }
);
