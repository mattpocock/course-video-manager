import { Config, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { computeEffectiveSections } from "@/packages/course-json";
import {
  computeExportHash,
  resolveExportPath,
  toExportClips,
} from "./export-hash";
import { VersionOperationsService } from "./db-version-operations.server";

/**
 * The shared walk behind batchExport and publish: which Videos a Course
 * Version ships under the given to-do toggle, titled
 * `section/lesson/videoTitle`. Withheld to-do Lessons' Videos are not
 * included.
 *
 * Two rosters come out of one walk, because the two phases of a Publish need
 * different halves of it:
 *
 * - `shippingVideos` — every Video the bundle will contain. The upload phase's
 *   per-Video tasks are drawn from this, because a Video a previous run already
 *   encoded still has to be uploaded.
 * - `unexportedVideos` — the subset with no export file on disk yet, which is
 *   what the export pool actually has work for.
 *
 * Same walk and same titles either way, so a Video's export task and its upload
 * task are one task.
 */
export const findShippingVideos = Effect.fn("findShippingVideos")(function* (
  versionId: string,
  includeTodoLessons: boolean
) {
  const effectFs = yield* FileSystem.FileSystem;
  const versionOps = yield* VersionOperationsService;
  const finishedVideosDirectory = yield* Config.string(
    "FINISHED_VIDEOS_DIRECTORY"
  );

  const version = yield* versionOps.getVersionWithSections(versionId);
  const courseId = version.repo.id;
  const effectiveSections = computeEffectiveSections(
    version.sections,
    includeTodoLessons
  );

  const shippingVideos: Array<{ id: string; title: string }> = [];
  const unexportedVideos: Array<{ id: string; title: string }> = [];

  for (const section of effectiveSections) {
    for (const lesson of section.lessons) {
      for (const video of lesson.videos) {
        const entry = {
          id: video.id,
          title: `${section.path}/${lesson.path}/${video.title}`,
        };
        shippingVideos.push(entry);

        if (video.clips.length === 0) continue;
        const hash = computeExportHash(
          toExportClips(video.clips),
          video.format
        );
        if (!hash) continue;
        const filePath = resolveExportPath(
          finishedVideosDirectory,
          courseId,
          hash
        );
        if (!(yield* effectFs.exists(filePath))) unexportedVideos.push(entry);
      }
    }
  }

  return { courseId, shippingVideos, unexportedVideos };
});
