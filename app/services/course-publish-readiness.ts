import { Config, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "./db-version-operations.server";
import {
  computeExportHash,
  resolveExportPath as resolveExportPathPure,
} from "./export-hash";
import { collectCourseViewLints } from "./lesson-warnings";
import {
  collectPublishBlockers,
  computeEffectiveSections,
} from "@/packages/course-json";

/**
 * PUBLISH READINESS — "what is between this Course and shipping?".
 *
 * Extracted from CoursePublishService so it can be read WITHOUT the export
 * stack. The publish service still owns the verb (it calls this as its
 * validation gate), but the question "is this publishable, and if not why"
 * needs only the version tree, the finished-videos directory, and a filesystem
 * — no VideoProcessingService, no FFmpeg, no OPENAI_API_KEY at layer-build
 * time. That is what lets `cvm course readiness` be a cheap, server-free read
 * (see app/cli/commands/course-readiness.ts).
 *
 * Whether a Video is EXPORTED is filesystem-derived, never a DB column: its
 * Export Hash (clip filenames, timestamps, order + the Export Version Key) is
 * matched against `{courseId}-{exportHash}.mp4` in FINISHED_VIDEOS_DIRECTORY.
 * An Unexported Video is one whose current hash matches no file on disk.
 */

/** A shipping Video that has no matching `.mp4` on disk. */
export type UnexportedVideo = {
  readonly id: string;
  readonly title: string;
};

const toExportClips = (
  clips: Array<{
    videoFilename: string;
    sourceStartTime: number;
    sourceEndTime: number;
    order: string;
  }>
) =>
  clips.map((c) => ({
    videoFilename: c.videoFilename,
    sourceStartTime: c.sourceStartTime,
    sourceEndTime: c.sourceEndTime,
  }));

/**
 * Validation gates on the effective output — the set of Lessons a publish
 * actually ships. Because the to-do toggle can flip on the publish page with no
 * round-trip, both positions are computed in a single pass: the expensive
 * per-Video existence checks run once, then the pure counters run against the
 * effective Sections for each toggle state.
 */
export const validatePublishability = Effect.fn("validatePublishability")(
  function* (versionId: string) {
    const versionOps = yield* VersionOperationsService;
    const effectFs = yield* FileSystem.FileSystem;
    const finishedVideosDirectory = yield* Config.string(
      "FINISHED_VIDEOS_DIRECTORY"
    );

    const version = yield* versionOps.getVersionWithSections(versionId);
    const courseId = version.repo.id;

    // Title lookup for the unexported set, built on the same walk as the
    // existence checks so the ids and their human labels can never drift.
    const titleById = new Map<string, string>();
    const exportedById = new Map<string, boolean>();
    for (const section of version.sections) {
      for (const lesson of section.lessons) {
        for (const video of lesson.videos) {
          titleById.set(
            video.id,
            `${section.path}/${lesson.path}/${video.title}`
          );
          if (video.clips.length === 0) continue;
          const hash = computeExportHash(
            toExportClips(video.clips),
            video.format
          );
          if (!hash) continue;
          const filePath = resolveExportPathPure(
            finishedVideosDirectory,
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
      const courseViewLints = collectCourseViewLints(effectiveSections);
      const courseViewLintCount = courseViewLints.length;

      // Publish blockers computed from the exact same walk buildCourseJson
      // uses (its backstop), so the pre-publish warnings and the build
      // failure can never disagree — see collectPublishBlockers.
      const { invalidLessonCombos, incompleteVideos } = collectPublishBlockers(
        version.sections,
        includeTodoLessons
      );

      return {
        unexportedVideoIds,
        // The same set, carrying `section/lesson/title` labels — so a caller
        // reporting the blockers never has to re-walk the tree to name them.
        unexportedVideos: unexportedVideoIds.map((id): UnexportedVideo => ({
          id,
          title: titleById.get(id) ?? id,
        })),
        courseViewLintCount,
        courseViewLints,
        invalidLessonCombos,
        incompleteVideos,
      };
    };

    // PROGRESS is deliberately toggle-independent and walks the WHOLE version
    // tree, not the effective output: a Lesson with no Videos yet is filtered
    // out of every publish, but it is exactly the work still to do. Blockers
    // answer "can this ship?"; progress answers "how far along is it?".
    const progress = {
      sections: version.sections.length,
      lessons: { total: 0, todo: 0, done: 0 },
      videos: { total: 0, exported: 0, unexported: 0, noClips: 0 },
    };
    for (const section of version.sections) {
      for (const lesson of section.lessons) {
        progress.lessons.total += 1;
        if (lesson.authoringStatus === "todo") progress.lessons.todo += 1;
        if (lesson.authoringStatus === "done") progress.lessons.done += 1;
        for (const video of lesson.videos) {
          if (video.archived) continue;
          progress.videos.total += 1;
          const exported = exportedById.get(video.id);
          if (exported === undefined) progress.videos.noClips += 1;
          else if (exported) progress.videos.exported += 1;
          else progress.videos.unexported += 1;
        }
      }
    }

    return {
      courseId,
      versionId: version.id,
      progress,
      withTodo: evaluate(true),
      withoutTodo: evaluate(false),
    };
  }
);

export type PublishReadiness = Effect.Effect.Success<
  ReturnType<typeof validatePublishability>
>;

/** One toggle position of {@link PublishReadiness}. */
export type PublishReadinessPosition = PublishReadiness["withTodo"];
