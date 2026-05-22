import path from "node:path";
import { Config, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { computeExportHash } from "@/services/export-hash";

/**
 * Garbage-collect stale exported files for a course.
 *
 * Collects all valid hashes across all versions in the DB, then deletes any
 * `{courseId}-*.mp4` files in the finished videos directory whose hash is not
 * in that set.
 *
 * Returns the list of deleted file paths.
 */
export const garbageCollect = (courseId: string) =>
  Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    const fs = yield* FileSystem.FileSystem;
    const finishedVideosDir = yield* Config.string("FINISHED_VIDEOS_DIRECTORY");

    const versionsMeta = yield* versionOps.getCourseVersions(courseId);
    const allValidHashes = new Set<string>();

    for (const meta of versionsMeta) {
      const version = yield* versionOps.getVersionWithSections(meta.id);
      for (const section of version.sections) {
        for (const lesson of section.lessons) {
          for (const video of lesson.videos) {
            const hash = computeExportHash(video.clips);
            if (hash) allValidHashes.add(hash);
          }
        }
      }
    }

    const prefix = `${courseId}-`;
    const suffix = ".mp4";
    const dirExists = yield* fs.exists(finishedVideosDir);
    if (!dirExists) return [];

    const allFiles = yield* fs.readDirectory(finishedVideosDir);
    const courseFiles = allFiles.filter(
      (f) => f.startsWith(prefix) && f.endsWith(suffix)
    );

    const deleted: string[] = [];
    for (const file of courseFiles) {
      const hash = file.slice(prefix.length, -suffix.length);
      if (!allValidHashes.has(hash)) {
        const filePath = path.join(finishedVideosDir, file);
        yield* fs.remove(filePath);
        deleted.push(filePath);
      }
    }

    return deleted;
  });
