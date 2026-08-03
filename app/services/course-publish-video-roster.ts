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
 *   what the export pool actually has work for. Each one also carries its
 *   `durationSeconds`, which the pool orders the queue by.
 *
 * Same walk and same titles either way, so a Video's export task and its upload
 * task are one task.
 */
// How long a Video runs: the sum of its Clips' source spans.
const clipsDurationSeconds = (
  clips: ReadonlyArray<{ sourceStartTime: number; sourceEndTime: number }>
): number =>
  clips.reduce(
    (total, clip) => total + (clip.sourceEndTime - clip.sourceStartTime),
    0
  );

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
  const unexportedVideos: Array<{
    id: string;
    title: string;
    durationSeconds: number;
  }> = [];

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
        if (!(yield* effectFs.exists(filePath)))
          unexportedVideos.push({
            ...entry,
            // Ordering only, so the raw clip sum is enough — the pause and
            // final-clip padding the export adds are far too small to reorder
            // the queue.
            durationSeconds: clipsDurationSeconds(video.clips),
          });
      }
    }
  }

  return { courseId, shippingVideos, unexportedVideos };
});
