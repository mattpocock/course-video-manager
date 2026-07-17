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
import { DoesNotExistOnDbError } from "./publish-to-dropbox";
import { collectCourseViewLints } from "./lesson-warnings";
import {
  collectPublishBlockers,
  computeEffectiveSections,
} from "@/packages/course-json";
import {
  DropboxCommitPendingError,
  ExportError,
  PublishValidationError,
} from "./course-publish-errors";
import { syncFrozenCourseVersionToDropbox } from "./course-publish-dropbox";

export type VideoForExport = {
  id: string;
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

const MAX_CONCURRENT_EXPORTS = 6;

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

        const hash = computeExportHash(toExportClips(video.clips));
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
        onStage?: (stage: "concatenating-clips" | "normalizing-audio") => void
      ) {
        const video = yield* videoOps.getVideoWithClipsById(videoId);
        const courseId = video.lesson?.section.repoVersion.repo.id;
        const owner: ExportOwner = courseId
          ? { kind: "course", courseId }
          : { kind: "standalone" };
        const namespace = courseId ?? videoId;

        const exportClips = toExportClips(video.clips);
        const hash = computeExportHash(exportClips);
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
        onStage?: (stage: "concatenating-clips" | "normalizing-audio") => void
      ) {
        const { targetPath, owner } = yield* exportVideoCore(videoId, onStage);
        if (owner.kind === "course") {
          yield* garbageCollect(owner.courseId);
        }
        return targetPath;
      });

      const batchExport = Effect.fn("batchExport")(function* (
        versionId: string,
        includeTodoLessons: boolean,
        sendEvent?: (event: string, data: unknown) => void
      ) {
        const version = yield* versionOps.getVersionWithSections(versionId);
        const courseId = version.repo.id;

        // Export only what this publish will ship — the effective Sections for
        // the current toggle. Withheld to-do Lessons' Videos are not exported.
        const effectiveSections = computeEffectiveSections(
          version.sections,
          includeTodoLessons
        );

        // Find unexported videos
        const unexportedVideos: Array<{
          id: string;
          title: string;
        }> = [];

        for (const section of effectiveSections) {
          for (const lesson of section.lessons) {
            for (const video of lesson.videos) {
              if (video.clips.length === 0) continue;
              const hash = computeExportHash(toExportClips(video.clips));
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

        sendEvent?.("videos", {
          videos: unexportedVideos.map((v) => ({
            id: v.id,
            title: v.title,
          })),
        });

        if (unexportedVideos.length === 0) return;

        for (const video of unexportedVideos) {
          sendEvent?.("stage", { videoId: video.id, stage: "queued" });
        }

        yield* Effect.forEach(
          unexportedVideos,
          (video) =>
            exportVideoCore(video.id, (stage) => {
              sendEvent?.("stage", { videoId: video.id, stage });
            }).pipe(
              Effect.retry(Schedule.recurs(2)),
              Effect.tap(() => {
                sendEvent?.("complete", { videoId: video.id });
              }),
              Effect.catchAll((e) =>
                Effect.sync(() => {
                  sendEvent?.("error", {
                    videoId: video.id,
                    message:
                      "message" in e && typeof e.message === "string"
                        ? e.message
                        : "Export failed unexpectedly",
                  });
                })
              )
            ),
          { concurrency: MAX_CONCURRENT_EXPORTS }
        );

        // GC once after all exports
        yield* garbageCollect(courseId);
      });

      // Validation gates on the effective output — the set of Lessons this
      // publish actually ships. Because the toggle can flip on the publish page
      // with no round-trip, both positions are computed in a single pass: the
      // expensive per-Video existence checks run once, then the pure counters
      // run against the effective Sections for each toggle state.
      const validatePublishability = Effect.fn("validatePublishability")(
        function* (versionId: string) {
          const version = yield* versionOps.getVersionWithSections(versionId);
          const courseId = version.repo.id;

          const exportedById = new Map<string, boolean>();
          for (const section of version.sections) {
            for (const lesson of section.lessons) {
              for (const video of lesson.videos) {
                if (video.clips.length === 0) continue;
                const hash = computeExportHash(toExportClips(video.clips));
                if (!hash) continue;
                const filePath = resolveExportPathPure(
                  FINISHED_VIDEOS_DIRECTORY,
                  courseId,
                  hash
                );
                exportedById.set(video.id, yield* effectFs.exists(filePath));
              }
            }
          }

          const evaluate = (includeTodoLessons: boolean) => {
            const effectiveSections = computeEffectiveSections(
              version.sections,
              includeTodoLessons
            );
            const unexportedVideoIds: string[] = [];
            for (const section of effectiveSections) {
              for (const lesson of section.lessons) {
                for (const video of lesson.videos) {
                  if (exportedById.get(video.id) === false) {
                    unexportedVideoIds.push(video.id);
                  }
                }
              }
            }
            const courseViewLints = collectCourseViewLints(effectiveSections);
            const courseViewLintCount = courseViewLints.length;

            // Publish blockers computed from the exact same walk buildCourseJson
            // uses (its backstop), so the pre-publish warnings and the build
            // failure can never disagree — see collectPublishBlockers.
            const { invalidLessonCombos, incompleteVideos } =
              collectPublishBlockers(version.sections, includeTodoLessons);

            return {
              unexportedVideoIds,
              courseViewLintCount,
              courseViewLints,
              invalidLessonCombos,
              incompleteVideos,
            };
          };

          return {
            withTodo: evaluate(true),
            withoutTodo: evaluate(false),
          };
        }
      );

      const syncFrozenVersionToDropboxUnlocked = Effect.fn(
        "syncFrozenVersionToDropboxUnlocked"
      )(function* (
        courseId: string,
        courseVersionId: string,
        includeTodoLessons: boolean,
        onProgress?: (event: string, data: unknown) => void
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
          onProgress?: (event: string, data: unknown) => void
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
          const versions = yield* versionOps.getCourseVersions(courseId);
          const latestFrozenVersion = versions.find(
            (version) => version.id !== latestVersion.id
          );
          if (!latestFrozenVersion) {
            return yield* new PublishValidationError({
              unfrozenCourseVersionId: latestVersion.id,
            });
          }
          return yield* syncFrozenVersionToDropboxUnlocked(
            courseId,
            latestFrozenVersion.id,
            includeTodoLessons,
            onProgress
          );
        }
      );

      const publishUnlocked = Effect.fn("publishUnlocked")(function* (
        courseId: string,
        versionName: string,
        versionDescription: string,
        includeTodoLessons: boolean,
        onProgress?: (
          stage:
            | "validating"
            | "exporting"
            | "uploading"
            | "freezing"
            | "cloning"
            | "complete"
        ) => void
      ) {
        onProgress?.("validating");

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
          onProgress?.("exporting");
          const failedVideoIds: string[] = [];
          yield* Effect.forEach(
            unexportedVideoIds,
            (videoId) =>
              exportVideoCore(videoId).pipe(
                Effect.retry(Schedule.recurs(2)),
                Effect.catchAll(() =>
                  Effect.sync(() => {
                    failedVideoIds.push(videoId);
                  })
                )
              ),
            { concurrency: MAX_CONCURRENT_EXPORTS }
          );
          if (failedVideoIds.length > 0) {
            return yield* new PublishValidationError({
              failedExportVideoIds: failedVideoIds,
            });
          }
          yield* garbageCollect(courseId);
        }

        onProgress?.("freezing");
        onProgress?.("cloning");
        const { version: newDraft } = yield* versionOps.freezeAndCloneVersion({
          sourceVersionId: latestVersion.id,
          repoId: courseId,
          newVersionName: "",
          sourceName: versionName,
          sourceDescription: versionDescription,
        });

        onProgress?.("uploading");
        const commitExit = yield* Effect.exit(
          syncFrozenVersionToDropboxUnlocked(
            courseId,
            latestVersion.id,
            includeTodoLessons
          )
        );
        if (Exit.isFailure(commitExit)) {
          return yield* new DropboxCommitPendingError({
            pendingVersionId: latestVersion.id,
            newDraftVersionId: newDraft.id,
            reason: "sync_failed",
            includeTodoLessons,
          });
        }
        if (commitExit.value.missingVideos.length > 0) {
          return yield* new DropboxCommitPendingError({
            pendingVersionId: latestVersion.id,
            newDraftVersionId: newDraft.id,
            reason: "missing_assets",
            includeTodoLessons,
            missingVideoIds: commitExit.value.missingVideos.map(
              (video) => video.videoId
            ),
          });
        }

        onProgress?.("complete");

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
        onProgress?: (event: string, data: unknown) => void
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
        onProgress?: (event: string, data: unknown) => void
      ) {
        return yield* courseVersionMutationSemaphore.withPermits(1)(
          syncToDropboxUnlocked(courseId, includeTodoLessons, onProgress)
        );
      });

      const publish = Effect.fn("publish")(function* (
        courseId: string,
        versionName: string,
        versionDescription: string,
        includeTodoLessons: boolean,
        onProgress?: (
          stage:
            | "validating"
            | "exporting"
            | "uploading"
            | "freezing"
            | "cloning"
            | "complete"
        ) => void
      ) {
        return yield* courseVersionMutationSemaphore.withPermits(1)(
          publishUnlocked(
            courseId,
            versionName,
            versionDescription,
            includeTodoLessons,
            onProgress
          )
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
