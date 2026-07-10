import { Config, Data, Effect, Schedule } from "effect";
import { Command, FileSystem } from "@effect/platform";
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
import {
  DoesNotExistOnDbError,
  resolveSectionsWithVideos,
} from "./publish-to-dropbox";
import { computeCourseViewLintCount } from "./lesson-warnings";
import {
  buildCourseJson,
  computeEffectiveSections,
} from "@/packages/course-json";

export class PublishValidationError extends Data.TaggedError(
  "PublishValidationError"
)<{
  unexportedVideoIds: string[];
  courseViewLintCount?: number;
}> {}

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
    order: c.order,
  }));

type ExportOwner =
  | { kind: "course"; courseId: string }
  | { kind: "standalone" };

export class ExportError extends Data.TaggedError("ExportError")<{
  message: string;
}> {}

export class CoursePublishService extends Effect.Service<CoursePublishService>()(
  "CoursePublishService",
  {
    effect: Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const versionOps = yield* VersionOperationsService;
      const videoProcessing = yield* VideoProcessingService;
      const effectFs = yield* FileSystem.FileSystem;
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

        // Render via ffmpeg → writes to {videoId}.mp4
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
            const courseViewLintCount =
              computeCourseViewLintCount(effectiveSections);
            return { unexportedVideoIds, courseViewLintCount };
          };

          return {
            withTodo: evaluate(true),
            withoutTodo: evaluate(false),
          };
        }
      );

      const syncToDropbox = Effect.fn("syncToDropbox")(function* (
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

        const DROPBOX_PATH = yield* Config.string("DROPBOX_PATH");

        const repoWithSections =
          yield* versionOps.getCourseWithSectionsByVersion({
            repoId: courseId,
            versionId: latestVersion.id,
          });

        // The effective Sections are the single source of "what this publish
        // ships". The Dropbox mirror and course.json both read from it, so they
        // can never disagree. Withheld to-do Lessons are absent here; the
        // stale-file cleanup below removes any of their previously-published
        // folders. Sections left with no shippable Lessons disappear entirely.
        const effectiveSections = computeEffectiveSections(
          repoWithSections.sections,
          includeTodoLessons
        );

        const videoPathOverrides = new Map<string, string>();
        for (const section of effectiveSections) {
          for (const lesson of section.lessons) {
            for (const video of lesson.videos) {
              if (video.clips.length > 0) {
                const hash = computeExportHash(toExportClips(video.clips));
                if (hash) {
                  videoPathOverrides.set(
                    video.id,
                    resolveExportPathPure(
                      FINISHED_VIDEOS_DIRECTORY,
                      courseId,
                      hash
                    )
                  );
                }
              }
            }
          }
        }

        const { sections, missingVideos } = yield* resolveSectionsWithVideos({
          sectionsInDb: effectiveSections,
          finishedVideosDirectory: FINISHED_VIDEOS_DIRECTORY,
          videoPathOverrides,
        });

        const totalLessons = sections.reduce(
          (sum, s) => sum + s.lessons.length,
          0
        );
        let completedLessons = 0;

        const copyFileSemaphore = yield* Effect.makeSemaphore(20);
        const dropboxCourseDir = path.join(DROPBOX_PATH, repoWithSections.name);
        const filesSupposedToBeInDropbox = new Set<string>();

        const copyFileToDropbox = Effect.fn("copyFileToDropbox")(
          function* (opts: { fromPath: string; toPath: string }) {
            yield* copyFileSemaphore.withPermits(1)(
              Effect.gen(function* () {
                yield* effectFs.makeDirectory(path.dirname(opts.toPath), {
                  recursive: true,
                });

                if (yield* effectFs.exists(opts.toPath)) {
                  const toPathStats = yield* effectFs.stat(opts.toPath);
                  const fromPathStats = yield* effectFs.stat(opts.fromPath);
                  if (toPathStats.size === fromPathStats.size) {
                    return;
                  }
                }

                yield* effectFs.copyFile(opts.fromPath, opts.toPath);
              })
            );

            filesSupposedToBeInDropbox.add(opts.toPath);
          }
        );

        for (const section of sections) {
          const dropboxSectionDir = path.join(dropboxCourseDir, section.path);

          for (const lesson of section.lessons) {
            const dropboxLessonDir = path.join(dropboxSectionDir, lesson.path);
            yield* effectFs.makeDirectory(dropboxLessonDir, {
              recursive: true,
            });

            for (const video of lesson.videos) {
              const extName = path.extname(video.absolutePath);
              yield* copyFileToDropbox({
                fromPath: video.absolutePath,
                toPath: path.join(dropboxLessonDir, `${video.name}${extName}`),
              });
            }

            completedLessons++;
            if (totalLessons > 0) {
              onProgress?.("progress", {
                percentage: Math.round((completedLessons / totalLessons) * 100),
              });
            }
          }
        }

        const courseJsonDoc = yield* buildCourseJson({
          courseId,
          courseName: repoWithSections.name,
          sections: repoWithSections.sections,
          includeTodoLessons,
        });
        const courseJsonPath = path.join(dropboxCourseDir, "course.json");
        yield* effectFs.makeDirectory(dropboxCourseDir, { recursive: true });
        yield* effectFs.writeFileString(
          courseJsonPath,
          JSON.stringify(courseJsonDoc, null, 2)
        );
        filesSupposedToBeInDropbox.add(courseJsonPath);

        const dropboxExists = yield* effectFs.exists(dropboxCourseDir);
        if (dropboxExists) {
          const allFiles = yield* effectFs
            .readDirectory(dropboxCourseDir, { recursive: true })
            .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));
          const filesToDelete = allFiles
            .map((file) => path.join(dropboxCourseDir, file))
            .filter((file) => !filesSupposedToBeInDropbox.has(file));

          for (const file of filesToDelete) {
            const isDir = yield* effectFs
              .stat(file)
              .pipe(Effect.map((s) => s.type === "Directory"));
            if (!isDir) {
              yield* effectFs.remove(file);
            }
          }
        }

        yield* Command.make(
          "find",
          dropboxCourseDir,
          "-type",
          "d",
          "-empty",
          "-delete"
        ).pipe(
          Command.exitCode,
          Effect.catchAll(() => Effect.succeed(0))
        );

        return { missingVideos };
      });

      const publish = Effect.fn("publish")(function* (
        courseId: string,
        versionName: string,
        versionDescription: string,
        includeTodoLessons: boolean,
        onProgress?: (
          stage:
            | "validating"
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

        // Gate on the effective output for the chosen toggle: an unfinished
        // to-do Lesson that is being withheld must not block a publish that is
        // not shipping it.
        const validation = yield* validatePublishability(latestVersion.id);
        const { unexportedVideoIds, courseViewLintCount } = includeTodoLessons
          ? validation.withTodo
          : validation.withoutTodo;
        if (unexportedVideoIds.length > 0 || courseViewLintCount > 0) {
          return yield* new PublishValidationError({
            unexportedVideoIds,
            courseViewLintCount,
          });
        }

        onProgress?.("uploading");
        yield* syncToDropbox(courseId, includeTodoLessons);

        onProgress?.("freezing");
        yield* versionOps.updateCourseVersion({
          versionId: latestVersion.id,
          name: versionName,
          description: versionDescription,
        });

        onProgress?.("cloning");
        const { version: newDraft } = yield* versionOps.copyVersionStructure({
          sourceVersionId: latestVersion.id,
          repoId: courseId,
          newVersionName: "",
        });

        onProgress?.("complete");

        return {
          publishedVersionId: latestVersion.id,
          newDraftVersionId: newDraft.id,
        };
      });

      return {
        exportVideo,
        batchExport,
        isExported,
        resolveExportPath,
        validatePublishability,
        syncToDropbox,
        publish,
      };
    }),
  }
) {}
