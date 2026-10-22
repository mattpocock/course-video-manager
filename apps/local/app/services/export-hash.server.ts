import path from "node:path";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { ClipMockupOperationsService } from "@/services/db-clip-mockup-operations.server";
import {
  ANIMATIC_EXPORT_SUFFIX,
  computeAnimaticExportHash,
  computeExportHash,
  toExportClips,
} from "@/services/export-hash";
import { SIDECAR_SUFFIX } from "@/services/export-sha256-sidecar";
import { storageRootsConfig } from "@/services/storage-roots";
import {
  assertUnderFinishedVideos,
  listFinishedVideosDirectories,
} from "@/services/finished-videos.server";
import { exportHashRenameRecorded } from "@/services/export-hash-rename";

/**
 * Garbage-collect stale exported files for a course.
 *
 * Collects all valid hashes across all versions in the DB, then deletes any
 * `{courseId}-*.mp4` files — and their `.sha256` digest sidecars — in the
 * `finished-videos/` folder of every Storage Root whose hash is not in that
 * set.
 *
 * REFUSES TO RUN (deletes nothing, returns `[]`) until the Exported Video
 * rename script has recorded that every export was renamed to its
 * root-relative Export Hash (`exportHashRenameRecorded`). Before that, every
 * finished video on disk is still named by its old, absolute-path hash, which
 * no current Video computes — so a GC in that window would delete every
 * export. See `apps/local/scripts/storage-rename-exports.ts`.
 *
 * An Exported Animatic (`{courseId}-{hash}.animatic.mp4`) is collected by
 * the same rule against the Animatic Export Hashes of the same Videos. Their
 * Clip Mockups are read only when there is an Exported Animatic on disk to
 * judge, so a Course that never exported one costs no extra query.
 *
 * Returns the list of deleted file paths.
 */
export const garbageCollect = (courseId: string) =>
  Effect.gen(function* () {
    const versionOps = yield* VersionOperationsService;
    const fs = yield* FileSystem.FileSystem;
    const roots = yield* storageRootsConfig;

    if (!(yield* exportHashRenameRecorded(roots))) {
      yield* Effect.logWarning(
        `export GC skipped for ${courseId}: the Exported Video rename to root-relative Export Hashes has not been recorded yet (run apps/local/scripts/storage-rename-exports.ts --apply)`
      );
      return [];
    }

    const prefix = `${courseId}-`;
    const listed = yield* listFinishedVideosDirectories(roots);
    const hasExportedAnimatic = listed.some(({ files }) =>
      files.some(
        (file) =>
          file.startsWith(prefix) && file.endsWith(ANIMATIC_EXPORT_SUFFIX)
      )
    );

    const versionsMeta = yield* versionOps.getCourseVersions(courseId);
    const allValidHashes = new Set<string>();
    const validAnimaticHashes = new Set<string>();

    for (const meta of versionsMeta) {
      const version = yield* versionOps.getVersionWithSections(meta.id);
      const videos = version.sections.flatMap((section) =>
        section.lessons.flatMap((lesson) => lesson.videos)
      );
      for (const video of videos) {
        const hash = computeExportHash(
          toExportClips(video.clips),
          video.format,
          roots
        );
        if (hash) allValidHashes.add(hash);
      }
      if (!hasExportedAnimatic) continue;
      const clipMockupOps = yield* ClipMockupOperationsService;
      const rows = yield* clipMockupOps.listAnimaticExportRowsByVideoIds(
        videos.map((video) => video.id)
      );
      for (const video of videos) {
        const hash = computeAnimaticExportHash({
          lineageId: video.lineageId,
          format: video.format,
          clipMockups: rows.filter((row) => row.videoId === video.id),
        });
        if (hash) validAnimaticHashes.add(hash);
      }
    }

    // An export and its digest sidecar share one Export Hash and one fate: the
    // sidecar describes only that file, so it is stale exactly when that file
    // is. Listed longest-first so `.mp4.sha256` is stripped before `.mp4`,
    // and `.animatic.mp4` before `.mp4`.
    const suffixes = [
      {
        suffix: `${ANIMATIC_EXPORT_SUFFIX}${SIDECAR_SUFFIX}`,
        valid: validAnimaticHashes,
      },
      { suffix: ANIMATIC_EXPORT_SUFFIX, valid: validAnimaticHashes },
      { suffix: `.mp4${SIDECAR_SUFFIX}`, valid: allValidHashes },
      { suffix: ".mp4", valid: allValidHashes },
    ];

    const deleted: string[] = [];
    for (const { dir, files } of listed) {
      for (const file of files) {
        if (!file.startsWith(prefix)) continue;
        const match = suffixes.find((s) => file.endsWith(s.suffix));
        if (!match) continue;
        const hash = file.slice(prefix.length, -match.suffix.length);
        if (match.valid.has(hash)) continue;
        const filePath = yield* assertUnderFinishedVideos(
          roots,
          path.join(dir, file)
        );
        yield* fs.remove(filePath);
        deleted.push(filePath);
      }
    }

    return deleted;
  });
