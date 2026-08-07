import { Config, Deferred, Effect, Exit, Schedule } from "effect";
import { CommandExecutor, FileSystem } from "@effect/platform";
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
import { ensureExportDigest } from "./export-sha256-sidecar";
import { FINAL_VIDEO_PADDING } from "@/features/video-editor/constants";
import { resolveVideoFormat } from "@/features/videos/video-format";
import { DoesNotExistOnDbError } from "./publish-to-dropbox";
import { validatePublishability as validatePublishabilityCore } from "./course-publish-readiness";
import { findShippingVideos as findShippingVideosCore } from "./course-publish-video-roster";
import {
  ExportError,
  PublishCommitFailedError,
  PublishValidationError,
} from "./course-publish-errors";
import {
  noExportPhase,
  resolveDropboxCourseDir,
  syncFrozenCourseVersionToDropbox,
} from "./course-publish-dropbox";
import { EMPTY_REUSE_PLAN, planBundleReuse } from "./course-publish-reuse-plan";
import { getValidDropboxAccessToken } from "./dropbox-auth-service";
import {
  extractErrorMessage,
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
    pauseType: string;
    zoomType: string;
    order: string;
  }>;
};

type ExportOwner =
  { kind: "course"; courseId: string } | { kind: "standalone" };

// The manual re-sync surface only ever reports the bundle-wide upload
// percentage — the per-Video task events belong to a Publish, which is the
// only caller that has an export phase to interleave them with.
type DropboxSyncProgressCallback = (
  event: "progress",
  data: { percentage: number }
) => void;

const onlyBundleProgress =
  (onProgress?: DropboxSyncProgressCallback): EmitPublishDetailEvent =>
  (e) => {
    if (e.event === "progress") onProgress?.("progress", e.data);
  };

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

        // Skip if already exported — but not before making sure it carries a
        // digest. An export that predates sidecars is exactly the one that
        // never gets encoded again, so this path is the only one that can
        // ever close the gap.
        if (yield* effectFs.exists(targetPath)) {
          yield* ensureExportDigest(effectFs, targetPath);
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
              zoomType: clip.zoomType,
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

        // Digest it now, while it is the newest thing on the disk. A later
        // Publish that copies this Video inside Dropbox rather than uploading
        // it never streams the bytes, so this is the only moment they are
        // guaranteed to pass through our hands.
        yield* ensureExportDigest(effectFs, targetPath);

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

      // The publish/export roster walk lives in ./course-publish-video-roster
      // so it can be read on its own. Its deps are closed over here so callers
      // of this service don't inherit them.
      const rosterContext = yield* Effect.context<
        VersionOperationsService | FileSystem.FileSystem
      >();
      const findShippingVideos = Effect.fn("findShippingVideos")(function* (
        versionId: string,
        includeTodoLessons: boolean
      ) {
        return yield* findShippingVideosCore(
          versionId,
          includeTodoLessons
        ).pipe(Effect.provide(rosterContext));
      });

      const batchExport = Effect.fn("batchExport")(function* (
        versionId: string,
        includeTodoLessons: boolean,
        onDetailEvent?: EmitPublishDetailEvent
      ) {
        const { courseId, unexportedVideos } = yield* findShippingVideos(
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
          return yield* syncFrozenCourseVersionToDropbox({
            courseId,
            courseVersionId: latestPublishedVersion.id,
            includeTodoLessons,
            onDetailEvent: onlyBundleProgress(onProgress),
            awaitVideoReady: noExportPhase,
          });
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
        const { courseViewLintCount } = includeTodoLessons
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

        // Re-walk with titles so both halves are observable per Video — the
        // export step emits the same events the standalone batchExport does,
        // and the upload phase draws its task roster from the same walk. The
        // Export Hash is untouched by Submit: the clone copies Clip
        // filenames, source timings and order verbatim and never mutates the
        // source rows, so this walk sees exactly what validation saw.
        const {
          unexportedVideos: rosterUnexportedVideos,
          shippingVideos,
          courseName: dropboxCourseName,
        } = yield* findShippingVideos(latestVersion.id, includeTodoLessons);

        // ── The reuse plan, drawn before the GPU is touched ─────────────────
        // A Video the previously Published Bundle already holds is copied
        // inside Dropbox, so it needs neither an upload nor an ENCODE. Drawing
        // the plan here — rather than inside the commit, where the copying
        // happens — is what lets it cancel work in the export pool.
        //
        // Any failure at all yields an empty plan. Reuse is an optimisation,
        // and a Publish must never fail because the optimisation could not be
        // worked out.
        // Captured here, where the export pool's context is still in scope, so
        // the commit can re-run a cancelled encode from inside its own.
        const commandExecutor = yield* CommandExecutor.CommandExecutor;

        const reusePlan = yield* Effect.gen(function* () {
          const accessToken = yield* getValidDropboxAccessToken;
          const dropboxCourseDir =
            yield* resolveDropboxCourseDir(dropboxCourseName);
          return yield* planBundleReuse({ accessToken, dropboxCourseDir });
        }).pipe(Effect.catchAll(() => Effect.succeed(EMPTY_REUSE_PLAN)));

        // Videos whose bytes Dropbox can produce on its own never enter the
        // export queue. This is the case that hurts most today: a re-Publish
        // after the garbage collector has reclaimed an export currently
        // re-encodes the whole Video only to upload bytes Dropbox already had.
        const unexportedVideos = rosterUnexportedVideos.filter(
          (video) => !reusePlan.has(video.exportHash)
        );

        // Announce the whole roster before either pool starts, so every Video
        // has a task from the outset rather than appearing when its bytes
        // happen to move.
        onDetailEvent?.({
          event: "upload-videos",
          data: { videos: shippingVideos },
        });

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

        // A Video with no latch already has its bytes on disk: it is waiting
        // for a slot in the upload pool from the very first moment, never
        // encoding.
        for (const video of shippingVideos) {
          if (exportLatches.has(video.id)) continue;
          onDetailEvent?.({
            event: "upload-queued",
            data: { videoId: video.id },
          });
        }

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
              if (exported) {
                // Out of the export pool, into the upload queue — the one
                // moment a Video is genuinely waiting rather than working.
                onDetailEvent?.({
                  event: "upload-queued",
                  data: { videoId },
                });
              }
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
          syncFrozenCourseVersionToDropbox({
            courseId,
            courseVersionId: latestVersion.id,
            includeTodoLessons,
            onDetailEvent,
            awaitVideoReady,
            // The same plan the export roster was filtered against. Handing it
            // over rather than letting the commit redraw it keeps the two
            // decisions identical — a Video dropped from the export queue is
            // exactly a Video the commit will copy.
            //
            // `restore` is the other half of that: the roster filter spent
            // this Video's local copy before the commit had proved it could
            // get the remote one, so the commit must be able to encode it
            // after all. It runs outside the export pool because the pool may
            // already have finished; fallbacks are rare enough that the GPU
            // contention costs less than the Publish it saves.
            cancelledExports: {
              plan: reusePlan,
              restore: (videoId: string): Effect.Effect<void, ExportError> =>
                exportVideoCore(videoId).pipe(
                  Effect.asVoid,
                  // Whatever an encode can go wrong with — a Video that has
                  // gone from the database, an ffmpeg that would not run —
                  // reaches the commit as the one failure it can attribute to
                  // a Video: this Video did not export.
                  Effect.catchAll((error) =>
                    Effect.fail(
                      new ExportError({
                        message: `Export failed for video ${videoId}: ${extractErrorMessage(
                          error,
                          "unknown error"
                        )}`,
                      })
                    )
                  ),
                  // The commit's context is fixed by the time it calls this,
                  // so ffmpeg's executor rides along from here rather than
                  // being demanded of the caller.
                  Effect.provideService(
                    CommandExecutor.CommandExecutor,
                    commandExecutor
                  )
                ),
            },
          }).pipe(Effect.retry(Schedule.recurs(1)))
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
          syncFrozenCourseVersionToDropbox({
            courseId,
            courseVersionId,
            includeTodoLessons,
            onDetailEvent: onlyBundleProgress(onProgress),
            awaitVideoReady: noExportPhase,
          })
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
