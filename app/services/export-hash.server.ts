import path from "node:path";
import { Config, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { computeExportHash } from "@/services/export-hash";
import { SIDECAR_SUFFIX } from "@/services/export-sha256-sidecar";

/**
 * Garbage-collect stale exported files for a course.
 *
 * Collects all valid hashes across all versions in the DB, then deletes any
 * `{courseId}-*.mp4` files — and their `.sha256` digest sidecars — in the
 * finished videos directory whose hash is not in that set.
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
            const hash = computeExportHash(video.clips, video.format);
            if (hash) allValidHashes.add(hash);
          }
        }
      }
    }

    const prefix = `${courseId}-`;
    // An export and its digest sidecar share one Export Hash and one fate: the
    // sidecar describes only that file, so it is stale exactly when that file
    // is. Listed longest-first so `.mp4.sha256` is stripped before `.mp4`.
    const suffixes = [`.mp4${SIDECAR_SUFFIX}`, ".mp4"];
    const dirExists = yield* fs.exists(finishedVideosDir);
    if (!dirExists) return [];

    const allFiles = yield* fs.readDirectory(finishedVideosDir);
    const courseFiles = allFiles.flatMap((f) => {
      if (!f.startsWith(prefix)) return [];
      const suffix = suffixes.find((s) => f.endsWith(s));
      return suffix ? [{ file: f, suffix }] : [];
    });

    const deleted: string[] = [];
    for (const { file, suffix } of courseFiles) {
      const hash = file.slice(prefix.length, -suffix.length);
      if (!allValidHashes.has(hash)) {
        const filePath = path.join(finishedVideosDir, file);
        yield* fs.remove(filePath);
        deleted.push(filePath);
      }
    }

    return deleted;
  });
