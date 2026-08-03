import { Config, Deferred, Effect, Exit, Schedule } from "effect";
import { FileSystem } from "@effect/platform";
import path from "node:path";
import { VideoOperationsService } from "./db-video-operations.server";
import { VersionOperationsService } from "./db-version-operations.server";
import {
  VideoProcessingService,
  type PauseType,
} from "./video-processing-service";
import {
  computeExportHash,
  resolveExportPath as resolveExportPathPure,
  toExportClips,
} from "./export-hash";
import { garbageCollect } from "./export-hash.server";
import { FINAL_VIDEO_PADDING } from "@/features/video-editor/constants";
import { resolveVideoFormat } from "@/features/videos/video-format";
import { DoesNotExistOnDbError } from "./publish-to-dropbox";
import { computeEffectiveSections } from "@/packages/course-json";
import { validatePublishability as validatePublishabilityCore } from "./course-publish-readiness";
import {
  ExportError,
  PublishCommitFailedError,
  PublishValidationError,
} from "./course-publish-errors";
import { syncFrozenCourseVersionToDropbox } from "./course-publish-dropbox";
import {
  runObservedExportLoop,
  type EmitPublishDetailEvent,
  type PublishStage,
} from "./course-publish-export-events";

export type VideoForExport = {
  id: string;
  format: string;
  lesson?: {
    section: { repoVersion: { repo: { id: string } } };
  } | null;
  clips: Array<{
    videoFilename: string;
    sourceStartTime: number;
    sourceEndTime: number;
    order: string;
  }>;
};

type ExportOwner =
  { kind: "course"; courseId: string } | { kind: "standalone" };

// The Dropbox commit only ever reports its per-lesson upload percentage.
type DropboxSyncProgressCallback = (
  event: "progress",
  data: { percentage: number }
) => void;

export type PublishOptions = {
  courseId: string;
  versionName: string;
  versionDescription: string;
  includeTodoLessons: boolean;
  // The coarse publish lifecycle stage (validating → … → complete).
  onStageChange?: (stage: PublishStage) => void;
  // Per-video export events (same names/payloads as batchExport: `videos`,
  // `stage`, `complete`, `error` keyed by videoId) plus the Dropbox commit's
  // `progress` percentage — pure observability.
  onDetailEvent?: EmitPublishDetailEvent;
};

export class CoursePublishService extends Effect.Service<CoursePublishService>()(
  "CoursePublishService",
  {
    effect: Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const versionOps = yield* VersionOperationsService;
      const videoProcessing = yield* VideoProcessingService;
      const effectFs = yield* FileSystem.FileSystem;
      // CVM is a single local operator process. Serialize every Course Version
      // lifecycle mutation so publish, manual sync, and create-version cannot
      // interleave around the database freeze and Dropbox commit marker.
      const courseVersionMutationSemaphore = yield* Effect.makeSemaphore(1);
      const FINISHED_VIDEOS_DIRECTORY = yield* Config.string(
        "FINISHED_VIDEOS_DIRECTORY"
      );

      const resolveExportPath = Effect.fn("resolveExportPath")(function* (
        videoOrId: string | VideoForExport
      ) {
        const video =
          typeof videoOrId === "string"
            ? yield* videoOps.getVideoWithClipsById(videoOrId)
            : videoOrId;
        if (video.clips.length === 0) return null;

        const hash = computeExportHash(
          toExportClips(video.clips),
          video.format
        );
        if (!hash) return null;

        const namespace = video.lesson?.section.repoVersion.repo.id ?? video.id;
        return resolveExportPathPure(
          FINISHED_VIDEOS_DIRECTORY,
          namespace,
          hash
        );
      });

      const isExported = Effect.fn("isExported")(function* (
        videoOrId: string | VideoForExport
      ) {
        const exportPath = yield* resolveExportPath(videoOrId);
        if (!exportPath) return false;
        return yield* effectFs.exists(exportPath);
      });

      const exportVideoCore = Effect.fn("exportVideoCore")(function* (
        videoId: string,
        onStage?: (stage: "concatenating-clips" | "normalizing-audio") => void,
        onProgress?: (info: {
          stage: "concatenating-clips" | "normalizing-audio";
          percent: number;
        }) => void
      ) {
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

        // Skip if already exported
        if (yield* effectFs.exists(targetPath)) {
          return { targetPath, owner };
        }

        // Export via ffmpeg → writes to {videoId}.mp4
        yield* videoProcessing.exportVideoClips({
          videoId,
          format: resolveVideoFormat(video.format),
          shortsDirectoryOutputName: undefined,
          clips: video.clips.map((clip, index, array) => {
            const isFinalClip = index === array.length - 1;
            return {
              inputVideo: clip.videoFilename,
              startTime: clip.sourceStartTime,
              duration:
                clip.sourceEndTime -
                clip.sourceStartTime +
                (isFinalClip ? FINAL_VIDEO_PADDING : 0),
              pauseType: (clip.pauseType as PauseType) || "none",
            };
          }),
          onStageChange: onStage,
          onProgress,
        });

        // Move from {videoId}.mp4 to content-addressed path
        const videoIdPath = path.join(
          FINISHED_VIDEOS_DIRECTORY,
          `${videoId}.mp4`
        );
        yield* effectFs.rename(videoIdPath, targetPath);

        return { targetPath, owner };
      });

      const exportVideo = Effect.fn("exportVideo")(function* (
        videoId: string,
        onStage?: (stage: "concatenating-clips" | "normalizing-audio") => void,
        onProgress?: (info: {
          stage: "concatenating-clips" | "normalizing-audio";
          percent: number;
        }) => void
      ) {
        const { targetPath, owner } = yield* exportVideoCore(
          videoId,
          onStage,
          onProgress
        );
        if (owner.kind === "course") {
          yield* garbageCollect(owner.courseId);
        }
        return targetPath;
      });

      // The shared walk behind batchExport and publish: which Videos this
      // publish/export will ship (the effective Sections for the toggle) that
      // have no export file yet, titled `section/lesson/videoTitle`. Withheld
      // to-do Lessons' Videos are not included.
      const findUnexportedVideos = Effect.fn("findUnexportedVideos")(function* (
        versionId: string,
        includeTodoLessons: boolean
      ) {
        const version = yield* versionOps.getVersionWithSections(versionId);
        const courseId = version.repo.id;
        const effectiveSections = computeEffectiveSections(
          version.sections,
          includeTodoLessons
        );

        const unexportedVideos: Array<{
          id: string;
          title: string;
        }> = [];

        for (const section of effectiveSections) {
          for (const lesson of section.lessons) {
            for (const video of lesson.videos) {
              if (video.clips.length === 0) continue;
              const hash = computeExportHash(
                toExportClips(video.clips),
                video.format
              );
              if (!hash) continue;
              const filePath = resolveExportPathPure(
                FINISHED_VIDEOS_DIRECTORY,
                courseId,
                hash
              );
              if (!(yield* effectFs.exists(filePath))) {
                unexportedVideos.push({
                  id: video.id,
                  title: `${section.path}/${lesson.path}/${video.title}`,
                });
              }
            }
          }
        }

        return { courseId, unexportedVideos };
      });

      const batchExport = Effect.fn("batchExport")(function* (
        versionId: string,
        includeTodoLessons: boolean,
        onDetailEvent?: EmitPublishDetailEvent
      ) {
        const { courseId, unexportedVideos } = yield* findUnexportedVideos(
          versionId,
          includeTodoLessons
        );

        yield* runObservedExportLoop({
          unexportedVideos,
          exportVideo: exportVideoCore,
          onDetailEvent,
        });

        if (unexportedVideos.length === 0) return;

        // GC once after all exports
        yield* garbageCollect(courseId);
      });

      // The publish validation gate. The computation itself lives in
      // ./course-publish-readiness so it can also be read on its own — by the
      // `cvm course readiness` CLI verb — without dragging in the export stack.
      // Its deps are closed over here so callers of this service method don't
      // inherit them.
      const readinessContext = yield* Effect.context<
        VersionOperationsService | FileSystem.FileSystem
      >();
      const validatePublishability = Effect.fn("validatePublishability")(
        function* (versionId: string) {
          return yield* validatePublishabilityCore(versionId).pipe(
            Effect.provide(readinessContext)
          );
        }
      );

      const syncFrozenVersionToDropboxUnlocked = Effect.fn(
        "syncFrozenVersionToDropboxUnlocked"
      )(function* (
        courseId: string,
        courseVersionId: string,
        includeTodoLessons: boolean,
        onProgress?: DropboxSyncProgressCallback,
        awaitVideoReady?: (videoId: string) => Effect.Effect<void, ExportError>
      ) {
        return yield* syncFrozenCourseVersionToDropbox({
          courseId,
          courseVersionId,
          includeTodoLessons,
          onProgress,
          awaitVideoReady,
        });
      });

      const syncToDropboxUnlocked = Effect.fn("syncToDropboxUnlocked")(
        function* (
          courseId: string,
          includeTodoLessons: boolean,
          onProgress?: DropboxSyncProgressCallback
        ) {
          const latestVersion =
            yield* versionOps.getLatestCourseVersion(courseId);
          if (!latestVersion) {
            return yield* new DoesNotExistOnDbError({
              type: "section",
              path: "",
              message: `No version found for repo ${courseId}`,
            });
          }
          // The commit state is authoritative: re-sync the newest Published
          // Version. (Previously inferred positionally as "first non-latest".)
          const latestPublishedVersion =
            yield* versionOps.getLatestPublishedVersion(courseId);
          if (!latestPublishedVersion) {
            return yield* new PublishValidationError({
              unfrozenCourseVersionId: latestVersion.id,
            });
          }
          return yield* syncFrozenVersionToDropboxUnlocked(
            courseId,
            latestPublishedVersion.id,
            includeTodoLessons,
            onProgress
          );
        }
      );

      const publishUnlocked = Effect.fn("publishUnlocked")(function* (
        options: PublishOptions
      ) {
        const {
          courseId,
          versionName,
          versionDescription,
          includeTodoLessons,
          onStageChange,
          onDetailEvent,
        } = options;
        onStageChange?.("validating");

        const latestVersion =
          yield* versionOps.getLatestCourseVersion(courseId);
        if (!latestVersion) {
          return yield* Effect.die(new Error("No version found for course"));
        }

        const validation = yield* validatePublishability(latestVersion.id);
        const { unexportedVideoIds, courseViewLintCount } = includeTodoLessons
          ? validation.withTodo
          : validation.withoutTodo;
        if (courseViewLintCount > 0) {
          return yield* new PublishValidationError({
            courseViewLintCount,
          });
        }

        // Submit FIRST. It is a pure database transaction with no dependency
        // on exports whatsoever, and it is what makes everything after it
        // sound: a Draft Version legally accepts Clip, Video and Section
        // writes, and a Video's title is its path inside the Dropbox bundle —
        // so encoding or uploading from a Draft lets an edit landing mid-flight
        // invalidate work already done.
        onStageChange?.("freezing");
        onStageChange?.("cloning");
        const { version: newDraft } = yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: latestVersion.id,
          repoId: courseId,
          newVersionName: "",
          sourceName: versionName,
          sourceDescription: versionDescription,
        });

        // Re-walk with titles so the export step is observable per Video —
        // the same walk (and events) the standalone batchExport emits. The
        // Export Hash is untouched by Submit: the clone copies Clip
        // filenames, source timings and order verbatim and never mutates the
        // source rows, so this walk sees exactly what validation saw.
        const unexportedVideos =
          unexportedVideoIds.length > 0
            ? (yield* findUnexportedVideos(
                latestVersion.id,
                includeTodoLessons
              )).unexportedVideos
            : [];

        // THE HANDOFF QUEUE between two pools that must not share a budget:
        // the export pool (GPU-bound, six-way concurrent) and the upload pool
        // (network-bound, its own smaller limit). One latch per Video still to
        // encode; a Video already exported has none and is ready immediately.
        // The upload pool waits on a single Video's latch rather than on the
        // export phase as a whole, which is what makes the two overlap.
        const exportLatches = new Map<
          string,
          Deferred.Deferred<void, ExportError>
        >();
        for (const video of unexportedVideos) {
          exportLatches.set(
            video.id,
            yield* Deferred.make<void, ExportError>()
          );
        }
        const awaitVideoReady = (videoId: string) => {
          const latch = exportLatches.get(videoId);
          return latch ? Deferred.await(latch) : Effect.void;
        };

        if (unexportedVideos.length > 0) onStageChange?.("exporting");
        onStageChange?.("uploading");

        const exportPhase = Effect.gen(function* () {
          if (unexportedVideos.length === 0) {
            return { failedVideoIds: [] as string[] };
          }
          return yield* runObservedExportLoop({
            unexportedVideos,
            exportVideo: exportVideoCore,
            onDetailEvent,
            onVideoSettled: ({ videoId, exported }) => {
              const latch = exportLatches.get(videoId)!;
              return exported
                ? Deferred.succeed(latch, undefined)
                : Deferred.fail(
                    latch,
                    new ExportError({
                      message: `Export failed for video ${videoId}`,
                    })
                  );
            },
          });
        }).pipe(
          // Never strand the upload pool waiting on a latch the export pool
          // will now never settle. Completing an already-settled latch is a
          // no-op, so this only catches the abnormal exits.
          Effect.ensuring(
            Effect.forEach(
              exportLatches.values(),
              (latch) =>
                Deferred.fail(
                  latch,
                  new ExportError({ message: "Export did not complete" })
                ),
              { discard: true }
            )
          )
        );

        // Commit: the Dropbox commit, culminating in the atomic `course.json`
        // rename — the external commit receipt. A caught failure is TERMINAL
        // for this Pending Version (issue #1401): retry the Commit once
        // in-flight (`sync_failed` only), then auto-Discard. The sync is
        // content-addressed and idempotent, so a later re-publish re-uploads
        // nothing that already landed.
        const commitPhase = Effect.exit(
          syncFrozenVersionToDropboxUnlocked(
            courseId,
            latestVersion.id,
            includeTodoLessons,
            (event, data) => onDetailEvent?.({ event, data }),
            awaitVideoReady
          ).pipe(Effect.retry(Schedule.recurs(1)))
        );

        // Both pools run to completion. Neither can fail outright — the export
        // loop collects its failures, the commit is captured as an Exit — so
        // neither ever interrupts the other mid-encode or mid-transfer.
        const [exportResult, commitExit] = yield* Effect.all(
          [exportPhase, commitPhase],
          { concurrency: 2 }
        );

        if (exportResult.failedVideoIds.length > 0) {
          // A Pending Version now exists by the time export can fail, so
          // Discard it rather than stranding it for manual reconciliation.
          // The error the caller sees is unchanged: the failed Video ids —
          // reported ahead of whatever the commit made of the failure.
          yield* versionOps.discardPendingVersion(latestVersion.id);
          return yield* new PublishValidationError({
            failedExportVideoIds: exportResult.failedVideoIds,
          });
        }
        if (Exit.isFailure(commitExit)) {
          yield* versionOps.discardPendingVersion(latestVersion.id);
          return yield* new PublishCommitFailedError({
            discardedVersionId: latestVersion.id,
            newDraftVersionId: newDraft.id,
            reason: "sync_failed",
          });
        }
        if (commitExit.value.missingVideos.length > 0) {
          // Missing assets are deterministic — retrying cannot conjure the
          // files — so Discard immediately, naming the missing Videos.
          yield* versionOps.discardPendingVersion(latestVersion.id);
          return yield* new PublishCommitFailedError({
            discardedVersionId: latestVersion.id,
            newDraftVersionId: newDraft.id,
            reason: "missing_assets",
            missingVideoIds: commitExit.value.missingVideos.map(
              (video) => video.videoId
            ),
          });
        }

        // Reclaim stale exports LAST, once every byte has gone past. GC deletes
        // any Exported Video whose Export Hash is unreachable from current
        // database state and cannot tell a file being streamed to Dropbox from
        // an abandoned one — so it must never run while uploads are in flight.
        // It has no correctness consumers, so the critical path is not its
        // place.
        if (unexportedVideos.length > 0) yield* garbageCollect(courseId);

        // Promote: the receipt landed, so the Pending Version is Published.
        yield* versionOps.promotePendingVersion(latestVersion.id);

        onStageChange?.("complete");

        return {
          publishedVersionId: latestVersion.id,
          newDraftVersionId: newDraft.id,
        };
      });

      const syncFrozenVersionToDropbox = Effect.fn(
        "syncFrozenVersionToDropbox"
      )(function* (
        courseId: string,
        courseVersionId: string,
        includeTodoLessons: boolean,
        onProgress?: DropboxSyncProgressCallback
      ) {
        return yield* courseVersionMutationSemaphore.withPermits(1)(
          syncFrozenVersionToDropboxUnlocked(
            courseId,
            courseVersionId,
            includeTodoLessons,
            onProgress
          )
        );
      });

      const syncToDropbox = Effect.fn("syncToDropbox")(function* (
        courseId: string,
        includeTodoLessons: boolean,
        onProgress?: DropboxSyncProgressCallback
      ) {
        return yield* courseVersionMutationSemaphore.withPermits(1)(
          syncToDropboxUnlocked(courseId, includeTodoLessons, onProgress)
        );
      });

      const publish = Effect.fn("publish")(function* (options: PublishOptions) {
        return yield* courseVersionMutationSemaphore.withPermits(1)(
          publishUnlocked(options)
        );
      });

      const createDraftVersion = Effect.fn("createDraftVersion")(
        function* (input: {
          sourceVersionId: string;
          repoId: string;
          newVersionName: string;
        }) {
          return yield* courseVersionMutationSemaphore.withPermits(1)(
            versionOps.copyVersionStructure(input)
          );
        }
      );

      return {
        exportVideo,
        batchExport,
        isExported,
        resolveExportPath,
        validatePublishability,
        syncFrozenVersionToDropbox,
        syncToDropbox,
        publish,
        createDraftVersion,
      };
    }),
  }
) {}
