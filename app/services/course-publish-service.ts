import { Config, Data, Effect, Schedule } from "effect";
import { Command, FileSystem } from "@effect/platform";
import path from "node:path";
import { CourseOperationsService } from "./db-course-operations.server";
import { VideoOperationsService } from "./db-video-operations.server";
import { VersionOperationsService } from "./db-version-operations.server";
import {
  VideoProcessingService,
  type BeatType,
} from "./video-processing-service";
import { CourseRepoParserService } from "./course-repo-parser";
import {
  computeExportHash,
  resolveExportPath as resolveExportPathPure,
  type ExportClip,
} from "./export-hash";
import { garbageCollect } from "./export-hash.server";
import { FINAL_VIDEO_PADDING } from "@/features/video-editor/constants";
import { generateChangelog } from "./changelog-service";
import { buildChapters, resolveSectionsWithVideos } from "./publish-to-dropbox";
import {
  formatProseTranscript,
  toTranscriptItems,
} from "@/lib/transcript-builder";

export class PublishValidationError extends Data.TaggedError(
  "PublishValidationError"
)<{
  unexportedVideoIds: string[];
}> {}

/** Minimal video shape needed by resolveExportPath / isExported */
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

const ALLOWED_FILE_EXTENSIONS_FROM_REPO = [
  ".ts",
  ".tsx",
  ".json",
  ".txt",
  ".md",
  ".mp4",
];

const TODO_MARKER_BODY = `# TODO

This lesson is marked **TODO** on the authoring side — it is intentionally incomplete in this version.

- If a stub for this lesson does **not** yet exist on the course platform, create one.
- If a stub **does** exist, leave it as-is. Do not edit it while this marker is present.

The marker will be removed automatically once the lesson is marked **Ready** in a future published version (see the \`Marked Ready\` section of \`changelog.md\`).
`;

/** Extract ExportClip data from DB clip records */
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
      const courseOps = yield* CourseOperationsService;
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

      /**
       * Core export logic without GC — used by both exportVideo and batchExport.
       * Returns { targetPath, owner } on success. `owner` distinguishes course
       * videos (GC-able by courseId) from standalone videos (no GC).
       */
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
              beatType: (clip.beatType as BeatType) || "none",
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
        sendEvent?: (event: string, data: unknown) => void
      ) {
        const version = yield* versionOps.getVersionWithSections(versionId);
        const courseId = version.repo.id;

        // Find unexported videos
        const unexportedVideos: Array<{
          id: string;
          title: string;
        }> = [];

        for (const section of version.sections) {
          for (const lesson of section.lessons) {
            if (lesson.fsStatus === "ghost") continue;
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
                  title: `${section.path}/${lesson.path}/${video.path}`,
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

      const validatePublishability = Effect.fn("validatePublishability")(
        function* (versionId: string) {
          const version = yield* versionOps.getVersionWithSections(versionId);
          const courseId = version.repo.id;

          const unexportedVideoIds: string[] = [];
          for (const section of version.sections) {
            for (const lesson of section.lessons) {
              if (lesson.fsStatus === "ghost") continue;
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
                  unexportedVideoIds.push(video.id);
                }
              }
            }
          }

          return { unexportedVideoIds };
        }
      );

      const publish = Effect.fn("publish")(function* (
        courseId: string,
        versionName: string,
        versionDescription: string,
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

        const { unexportedVideoIds } = yield* validatePublishability(
          latestVersion.id
        );
        if (unexportedVideoIds.length > 0) {
          return yield* new PublishValidationError({ unexportedVideoIds });
        }

        // Upload to Dropbox
        onProgress?.("uploading");
        const DROPBOX_PATH = yield* Config.string("DROPBOX_PATH");
        const course = yield* courseOps.getCourseById(courseId);
        const repoParser = yield* CourseRepoParserService;

        const repoWithSections =
          yield* versionOps.getCourseWithSectionsByVersion({
            repoId: courseId,
            versionId: latestVersion.id,
          });

        const sectionsOnFileSystem = yield* repoParser.parseRepo(
          repoWithSections.filePath!
        );

        // Build content-addressed path overrides for video resolution
        const videoPathOverrides = new Map<string, string>();
        for (const section of repoWithSections.sections) {
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

        const { sections } = yield* resolveSectionsWithVideos({
          sectionsOnFileSystem,
          sectionsInDb: repoWithSections.sections,
          finishedVideosDirectory: FINISHED_VIDEOS_DIRECTORY,
          videoPathOverrides,
        });

        const dropboxCourseDir = path.join(DROPBOX_PATH, course.name);
        const filesSupposedToBeInDropbox = new Set<string>();

        const videoTranscriptItemsMap = new Map<
          string,
          ReturnType<typeof toTranscriptItems>
        >();
        const videoChaptersMap = new Map<
          string,
          ReturnType<typeof buildChapters>
        >();
        // Build a lookup of lesson authoring status keyed by sectionPath/lessonPath
        const lessonTodoSet = new Set<string>();
        for (const section of repoWithSections.sections) {
          for (const lesson of section.lessons) {
            if (lesson.authoringStatus === "todo") {
              lessonTodoSet.add(`${section.path}/${lesson.path}`);
            }
            for (const video of lesson.videos) {
              videoTranscriptItemsMap.set(
                video.id,
                toTranscriptItems(video.clips, video.chapters)
              );
              videoChaptersMap.set(
                video.id,
                buildChapters(video.clips, video.chapters)
              );
            }
          }
        }

        for (const section of sections) {
          const dropboxSectionDir = path.join(dropboxCourseDir, section.path);

          for (const lesson of section.lessons) {
            const dropboxLessonDir = path.join(dropboxSectionDir, lesson.path);
            yield* effectFs.makeDirectory(dropboxLessonDir, {
              recursive: true,
            });

            if (lessonTodoSet.has(`${section.path}/${lesson.path}`)) {
              const todoMarkerPath = path.join(dropboxLessonDir, "TODO.md");
              yield* effectFs.writeFileString(todoMarkerPath, TODO_MARKER_BODY);
              filesSupposedToBeInDropbox.add(todoMarkerPath);
            }

            for (const video of lesson.videos) {
              const extName = path.extname(video.absolutePath);
              const destPath = path.join(
                dropboxLessonDir,
                `${video.name}${extName}`
              );

              // Copy video (skip if same size)
              if (yield* effectFs.exists(destPath)) {
                const destStat = yield* effectFs.stat(destPath);
                const srcStat = yield* effectFs.stat(video.absolutePath);
                if (destStat.size !== srcStat.size) {
                  yield* effectFs.copyFile(video.absolutePath, destPath);
                }
              } else {
                yield* effectFs.copyFile(video.absolutePath, destPath);
              }
              filesSupposedToBeInDropbox.add(destPath);

              // Write chapters meta file
              const chapters = videoChaptersMap.get(video.id);
              if (chapters) {
                const metaPath = path.join(
                  dropboxLessonDir,
                  `${video.name}.meta.json`
                );
                yield* effectFs.writeFileString(
                  metaPath,
                  JSON.stringify({ chapters }, null, 2)
                );
                filesSupposedToBeInDropbox.add(metaPath);
              }

              // Write transcript
              const transcriptItems = videoTranscriptItemsMap.get(video.id);
              if (transcriptItems && transcriptItems.length > 0) {
                const transcript = formatProseTranscript(transcriptItems);
                if (transcript) {
                  const transcriptPath = path.join(
                    dropboxLessonDir,
                    `${video.name}.transcript.md`
                  );
                  yield* effectFs.writeFileString(transcriptPath, transcript);
                  filesSupposedToBeInDropbox.add(transcriptPath);
                }
              }
            }

            // Copy source files from course repo
            const lessonDir = path.join(
              repoWithSections.filePath!,
              section.path,
              lesson.path
            );

            const dirExists = yield* effectFs.exists(lessonDir);
            if (dirExists) {
              const files = yield* effectFs
                .readDirectory(lessonDir, { recursive: true })
                .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));
              for (const file of files) {
                if (
                  ALLOWED_FILE_EXTENSIONS_FROM_REPO.includes(
                    path.extname(file)
                  ) &&
                  !file.includes("node_modules")
                ) {
                  const fromPath = path.join(lessonDir, file);
                  const toPath = path.join(dropboxLessonDir, file);
                  yield* effectFs.makeDirectory(path.dirname(toPath), {
                    recursive: true,
                  });
                  if (yield* effectFs.exists(toPath)) {
                    const toStat = yield* effectFs.stat(toPath);
                    const fromStat = yield* effectFs.stat(fromPath);
                    if (toStat.size !== fromStat.size) {
                      yield* effectFs.copyFile(fromPath, toPath);
                    }
                  } else {
                    yield* effectFs.copyFile(fromPath, toPath);
                  }
                  filesSupposedToBeInDropbox.add(toPath);
                }
              }
            }
          }
        }

        // Delete stale files from Dropbox
        const dropboxExists = yield* effectFs.exists(dropboxCourseDir);
        if (dropboxExists) {
          const allFiles = yield* effectFs
            .readDirectory(dropboxCourseDir, { recursive: true })
            .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));
          const filesToDelete = allFiles
            .filter((file) =>
              ALLOWED_FILE_EXTENSIONS_FROM_REPO.includes(path.extname(file))
            )
            .map((file) => path.join(dropboxCourseDir, file))
            .filter((file) => !filesSupposedToBeInDropbox.has(file));
          yield* Effect.forEach(filesToDelete, (file) => effectFs.remove(file));
        }

        // Generate changelog (treat draft as published with given name)
        const allVersions =
          yield* versionOps.getAllVersionsWithStructure(courseId);
        const changelogVersions = allVersions.map((v) =>
          v.id === latestVersion.id
            ? { ...v, name: versionName, description: versionDescription }
            : v
        );
        const changelogContent = generateChangelog(changelogVersions);
        const changelogPath = path.join(dropboxCourseDir, "changelog.md");
        yield* effectFs.writeFileString(changelogPath, changelogContent);

        // Delete empty directories
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

        // Freeze draft (set name/description)
        onProgress?.("freezing");
        yield* versionOps.updateCourseVersion({
          versionId: latestVersion.id,
          name: versionName,
          description: versionDescription,
        });

        // Clone new draft
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
        publish,
      };
    }),
  }
) {}
