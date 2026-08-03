import { Config, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { computeEffectiveSections } from "@/packages/course-json";
import {
  computeExportHash,
  resolveExportPath,
  toExportClips,
} from "./export-hash";
import { VersionOperationsService } from "./db-version-operations.server";

// The summed source span of a Video's Clips. Shorter than the exported file,
// which also carries FINAL_VIDEO_PADDING and a pause per `long` Clip.
const clipsDurationSeconds = (
  clips: ReadonlyArray<{ sourceStartTime: number; sourceEndTime: number }>
): number =>
  clips.reduce(
    (total, clip) => total + (clip.sourceEndTime - clip.sourceStartTime),
    0
  );

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
 *   what the export pool actually has work for. Ordered longest Video first,
 *   because this is where that queue is built.
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
            durationSeconds: clipsDurationSeconds(video.clips),
          });
      }
    }
  }

  // The queue's running order: longest Video first. The export loop runs
  // MAX_CONCURRENT_EXPORTS at a time, so whichever Videos start last decide
  // when the whole run finishes — starting the longest first keeps a slow Video
  // from being picked up at the end and stretching the tail on its own.
  // `durationSeconds` is a proxy: it omits the padding ffmpeg adds, which can
  // flip two Videos of near-equal length. That costs nothing, since near-equal
  // Videos are interchangeable here. Exact ties keep the walk order
  // (section → lesson → title), as sort is stable.
  unexportedVideos.sort((a, b) => b.durationSeconds - a.durationSeconds);

  return { courseId, shippingVideos, unexportedVideos };
});
