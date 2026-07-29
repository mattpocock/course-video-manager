import { Config, Effect, Exit, Schedule } from "effect";
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
  type ExportClip,
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

const toExportClips = (
  clips: Array<{
    videoFilename: string;
    sourceStartTime: number;
    sourceEndTime: number;
    order: string;
  }>
): ExportClip[] =>
  clips.map((c) => ({
    videoFilename: c.videoFilename,
    sourceStartTime: c.sourceStartTime,
    sourceEndTime: c.sourceEndTime,
  }));

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
        onProgress?: DropboxSyncProgressCallback
      ) {
        return yield* syncFrozenCourseVersionToDropbox({
          courseId,
          courseVersionId,
          includeTodoLessons,
          onProgress,
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

        if (unexportedVideoIds.length > 0) {
          onStageChange?.("exporting");
          // Re-walk with titles so the export step is observable per Video —
          // the same walk (and events) the standalone batchExport emits.
          const { unexportedVideos } = yield* findUnexportedVideos(
            latestVersion.id,
            includeTodoLessons
          );
          const { failedVideoIds } = yield* runObservedExportLoop({
            unexportedVideos,
            exportVideo: exportVideoCore,
            onDetailEvent,
          });
          if (failedVideoIds.length > 0) {
            return yield* new PublishValidationError({
              failedExportVideoIds: failedVideoIds,
            });
          }
          yield* garbageCollect(courseId);
        }

        onStageChange?.("freezing");
        onStageChange?.("cloning");
        const { version: newDraft } = yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: latestVersion.id,
          repoId: courseId,
          newVersionName: "",
          sourceName: versionName,
          sourceDescription: versionDescription,
        });

        onStageChange?.("uploading");
        // Commit: the Dropbox commit, culminating in the atomic `course.json`
        // rename — the external commit receipt. A caught failure is TERMINAL
        // for this Pending Version (issue #1401): retry the Commit once
        // in-flight (`sync_failed` only), then auto-Discard. The sync is
        // content-addressed and idempotent, so a later re-publish re-uploads
        // nothing that already landed.
        const commitExit = yield* Effect.exit(
          syncFrozenVersionToDropboxUnlocked(
            courseId,
            latestVersion.id,
            includeTodoLessons,
            (event, data) => onDetailEvent?.({ event, data })
          ).pipe(Effect.retry(Schedule.recurs(1)))
        );
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
