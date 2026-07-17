import { Config, Effect, Stream } from "effect";
import { FileSystem } from "@effect/platform";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  buildCourseJson,
  buildCourseJsonSchema,
  computeEffectiveSections,
} from "@/packages/course-json";
import {
  computeExportHash,
  resolveExportPath,
  type ExportClip,
} from "./export-hash";
import { VersionOperationsService } from "./db-version-operations.server";
import { ExportError, PublishValidationError } from "./course-publish-errors";
import { resolveSectionsWithVideos } from "./publish-to-dropbox";

const toExportClips = (
  clips: Array<{
    videoFilename: string;
    sourceStartTime: number;
    sourceEndTime: number;
    order: string;
  }>
): ExportClip[] =>
  clips.map((clip) => ({
    videoFilename: clip.videoFilename,
    sourceStartTime: clip.sourceStartTime,
    sourceEndTime: clip.sourceEndTime,
  }));

export const syncFrozenCourseVersionToDropbox = Effect.fn(
  "syncFrozenCourseVersionToDropbox"
)(function* (input: {
  courseId: string;
  courseVersionId: string;
  includeTodoLessons: boolean;
  onProgress?: (event: string, data: unknown) => void;
}) {
  const effectFs = yield* FileSystem.FileSystem;
  const versionOps = yield* VersionOperationsService;
  const finishedVideosDirectory = yield* Config.string(
    "FINISHED_VIDEOS_DIRECTORY"
  );
  const dropboxPath = yield* Config.string("DROPBOX_PATH");

  const hashFile = Effect.fn("hashFileSha256")(function* (filePath: string) {
    const hash = createHash("sha256");
    const bytes = yield* effectFs.stream(filePath).pipe(
      Stream.runFold(0, (total, chunk) => {
        hash.update(chunk);
        return total + chunk.byteLength;
      })
    );
    return { sha256: hash.digest("hex"), bytes };
  });

  const targetVersion = yield* versionOps.getCourseVersionById(
    input.courseVersionId
  );
  const latestVersion = yield* versionOps.getLatestCourseVersion(
    input.courseId
  );
  if (
    targetVersion.repoId !== input.courseId ||
    !latestVersion ||
    latestVersion.id === input.courseVersionId
  ) {
    return yield* new PublishValidationError({
      unfrozenCourseVersionId: input.courseVersionId,
    });
  }

  const repoWithSections = yield* versionOps.getCourseWithSectionsByVersion({
    repoId: input.courseId,
    versionId: input.courseVersionId,
  });

  // The effective Sections are the single source of what this publish ships.
  // Prior immutable bundles remain intact for replay and rollback.
  const effectiveSections = computeEffectiveSections(
    repoWithSections.sections,
    input.includeTodoLessons
  );

  const videoPathOverrides = new Map<string, string>();
  for (const section of effectiveSections) {
    for (const lesson of section.lessons) {
      for (const video of lesson.videos) {
        if (video.clips.length === 0) continue;
        const hash = computeExportHash(toExportClips(video.clips));
        if (!hash) continue;
        videoPathOverrides.set(
          video.id,
          resolveExportPath(finishedVideosDirectory, input.courseId, hash)
        );
      }
    }
  }

  const { sections, missingVideos } = yield* resolveSectionsWithVideos({
    sectionsInDb: effectiveSections,
    finishedVideosDirectory,
    videoPathOverrides,
  });
  if (missingVideos.length > 0) return { missingVideos };

  const totalLessons = sections.reduce(
    (sum, section) => sum + section.lessons.length,
    0
  );
  let completedLessons = 0;
  const syncId = randomUUID();
  const dropboxCourseDir = path.join(dropboxPath, repoWithSections.name);
  const stagingDir = path.join(dropboxCourseDir, `.cvm-staging-${syncId}`);
  const manifestTempPath = path.join(dropboxCourseDir, `.course-${syncId}.tmp`);
  const courseJsonPath = path.join(dropboxCourseDir, "course.json");
  const videoAssets = new Map<string, { sha256: string; bytes: number }>();
  const stagedVideos: Array<{
    videoId: string;
    sourcePath: string;
    stagedPath: string;
    relativeAssetPath: string;
  }> = [];

  const manifestJson = yield* Effect.gen(function* () {
    yield* effectFs.makeDirectory(stagingDir, { recursive: true });

    // Stage, copy, and hash each Video in a single traversal. Building the
    // staged list here — rather than in a prior loop re-walked by a positional
    // index — keeps the staged entries, the copied files, and the asset hashes
    // from ever drifting out of the Section → Lesson → Video order they all
    // derive from.
    for (const section of sections) {
      for (const lesson of section.lessons) {
        for (const video of lesson.videos) {
          const extName = path.extname(video.absolutePath);
          const relativeAssetPath = `${section.path}/${lesson.path}/${video.name}${extName}`;
          const stagedVideo = {
            videoId: video.id,
            sourcePath: video.absolutePath,
            stagedPath: path.join(stagingDir, ...relativeAssetPath.split("/")),
            relativeAssetPath,
          };
          stagedVideos.push(stagedVideo);
          yield* effectFs.makeDirectory(path.dirname(stagedVideo.stagedPath), {
            recursive: true,
          });
          yield* effectFs.copyFile(
            stagedVideo.sourcePath,
            stagedVideo.stagedPath
          );
          videoAssets.set(
            stagedVideo.videoId,
            yield* hashFile(stagedVideo.stagedPath)
          );
        }

        completedLessons++;
        if (totalLessons > 0) {
          input.onProgress?.("progress", {
            percentage: Math.round((completedLessons / totalLessons) * 100),
          });
        }
      }
    }

    const schemaJson = JSON.stringify(buildCourseJsonSchema(), null, 2);
    const assetFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          schemaJson,
          courseId: input.courseId,
          courseVersionId: input.courseVersionId,
          courseName: repoWithSections.name,
          includeTodoLessons: input.includeTodoLessons,
          sections: repoWithSections.sections,
          videos: stagedVideos.map((video) => ({
            relativeAssetPath: video.relativeAssetPath,
            ...videoAssets.get(video.videoId)!,
          })),
        })
      )
      .digest("hex")
      .slice(0, 32);
    const versionFingerprint = createHash("sha256")
      .update(input.courseVersionId)
      .digest("hex")
      .slice(0, 16);
    const assetBasePath = `versions/${versionFingerprint}-${assetFingerprint}`;
    const finalBundleDir = path.join(
      dropboxCourseDir,
      ...assetBasePath.split("/")
    );
    const courseJsonDoc = yield* buildCourseJson({
      courseId: input.courseId,
      courseVersionId: input.courseVersionId,
      courseName: repoWithSections.name,
      assetBasePath,
      sections: repoWithSections.sections,
      videoAssets,
      includeTodoLessons: input.includeTodoLessons,
    });
    const manifestJson = JSON.stringify(courseJsonDoc, null, 2);
    yield* effectFs.writeFileString(
      path.join(stagingDir, "course.schema.json"),
      schemaJson
    );
    // `manifest.json` is the bundle's own immutable, self-describing copy of the
    // course document: it lives inside the content-addressed bundle dir and is
    // frozen there forever alongside the assets it fingerprints. The identical
    // bytes are also written to the root `course.json` below, but the two serve
    // distinct roles and are intentionally duplicated — see the root write.
    yield* effectFs.writeFileString(
      path.join(stagingDir, "manifest.json"),
      manifestJson
    );

    yield* effectFs.makeDirectory(path.dirname(finalBundleDir), {
      recursive: true,
    });
    if (yield* effectFs.exists(finalBundleDir)) {
      for (const video of stagedVideos) {
        const finalPath = path.join(
          finalBundleDir,
          ...video.relativeAssetPath.split("/")
        );
        if (!(yield* effectFs.exists(finalPath))) {
          return yield* new ExportError({
            message: `Immutable asset bundle is missing video ${video.videoId}`,
          });
        }
        const expected = videoAssets.get(video.videoId)!;
        const actual = yield* hashFile(finalPath);
        if (
          actual.sha256 !== expected.sha256 ||
          actual.bytes !== expected.bytes
        ) {
          return yield* new ExportError({
            message: `Immutable asset bundle conflict for video ${video.videoId}`,
          });
        }
      }
      const existingSchema = yield* effectFs.readFileString(
        path.join(finalBundleDir, "course.schema.json")
      );
      if (existingSchema !== schemaJson) {
        return yield* new ExportError({
          message: "Immutable asset bundle schema conflict",
        });
      }
      const existingManifest = yield* effectFs.readFileString(
        path.join(finalBundleDir, "manifest.json")
      );
      if (existingManifest !== manifestJson) {
        return yield* new ExportError({
          message: "Immutable asset bundle manifest conflict",
        });
      }
    } else {
      yield* effectFs.rename(stagingDir, finalBundleDir);
    }

    return manifestJson;
  }).pipe(
    Effect.ensuring(
      effectFs
        .remove(stagingDir, { recursive: true, force: true })
        .pipe(Effect.orDie)
    )
  );

  yield* Effect.gen(function* () {
    yield* effectFs.writeFileString(manifestTempPath, manifestJson);
    // Root `course.json` is the mutable commit marker: consumers read it first,
    // and its atomic rename is the sole receipt that this publish committed. It
    // is overwritten on every publish to point at the newest bundle, whereas the
    // byte-identical `manifest.json` inside the bundle dir stays immutable. The
    // duplication is deliberate — the bundle stays self-describing in isolation
    // while the root marker always names the current release — so it is the
    // final successful write.
    yield* effectFs.rename(manifestTempPath, courseJsonPath);
  }).pipe(
    Effect.onError(() =>
      effectFs.remove(manifestTempPath, { force: true }).pipe(Effect.orDie)
    )
  );

  return { missingVideos };
});
