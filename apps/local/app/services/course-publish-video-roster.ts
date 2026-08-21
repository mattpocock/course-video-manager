import { Config, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { computeEffectiveSections } from "@/packages/course-json";
import {
  computeExportHash,
  resolveExportPath,
  toExportClips,
} from "./export-hash";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { readExportDurationInSeconds } from "./export-sha256-sidecar";
import {
  expectedExportDurationInSeconds,
  isExportUnacceptablyShort,
  paddedClipDurationsInSeconds,
  type SourceClipDuration,
} from "./export-duration-check";

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
 * Is there an export at this address that this machine ALREADY KNOWS is sound?
 *
 * A file at the address used to be the whole answer, and that is how three
 * truncated exports survived every later Publish. The export step now checks a
 * file it finds on disk against the duration its Clips ask for — so this walk
 * has to hand it every export whose duration it cannot vouch for, not only the
 * ones that are missing.
 *
 * Only the recorded duration is consulted, never ffprobe: this runs once per
 * Video of a whole Course, before anything else has begun. An export with a
 * duration in its Export Digest is decided here for nothing; an export without
 * one is visited by the export step, which measures it once and records it, so
 * the question is free from then on.
 */
const isKnownSoundExport = Effect.fn("isKnownSoundExport")(function* (
  effectFs: FileSystem.FileSystem,
  exportPath: string,
  clips: ReadonlyArray<SourceClipDuration>
) {
  if (!(yield* effectFs.exists(exportPath))) return false;
  const actualDurationInSeconds = yield* readExportDurationInSeconds(
    effectFs,
    exportPath
  );
  if (actualDurationInSeconds === null) return false;
  return !isExportUnacceptablyShort({
    expectedDurationInSeconds: expectedExportDurationInSeconds(
      paddedClipDurationsInSeconds(clips)
    ),
    actualDurationInSeconds,
  });
});

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
        if (yield* isKnownSoundExport(effectFs, filePath, video.clips))
          continue;
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

  return {
    courseId,
    courseName: version.repo.name,
    shippingVideos,
    unexportedVideos,
  };
});
