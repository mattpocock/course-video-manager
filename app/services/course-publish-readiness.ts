import { Config, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "./db-version-operations.server";
import {
  computeExportHash,
  resolveExportPath as resolveExportPathPure,
  toExportClips,
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
 * validation gate), but the question "what stands between this Course and
 * shipping" needs only the version tree, the finished-videos directory, and a
 * filesystem — no VideoProcessingService, no FFmpeg, no OPENAI_API_KEY at
 * layer-build time. That is what lets `cvm course readiness` be a cheap,
 * server-free read (see app/cli/commands/course-readiness.ts).
 *
 * Whether a Video is EXPORTED is filesystem-derived, never a DB column: its
 * Export Hash (clip filenames, timestamps, order + the Export Version Key) is
 * matched against `{courseId}-{exportHash}.mp4` in FINISHED_VIDEOS_DIRECTORY.
 * An Unexported Video is one whose current hash matches no file on disk.
 *
 * THE FOUR LISTS DO NOT ALL BLOCK A PUBLISH, and callers must not treat them as
 * interchangeable. Against `publish` (see course-publish-service):
 *   courseViewLints       REFUSE the publish outright (PublishValidationError).
 *   invalidLessonCombos   Not checked at the gate; they fail the later
 *   incompleteVideos      course.json build, so the publish still cannot land.
 *   unexportedVideoIds    Do NOT refuse anything — publish RENDERS them as its
 *                         `exporting` stage and carries on. They are pending
 *                         machine work (and a failed render does abort), not an
 *                         authoring gap.
 * Anything reporting a single "can this ship?" boolean must therefore leave the
 * unexported set out of it — see PUBLISH_BLOCKING_LISTS below.
 */

/**
 * The lists whose emptiness decides whether a publish can complete. Deliberately
 * excludes `unexportedVideoIds`: publish exports those itself.
 */
export const PUBLISH_BLOCKING_LISTS = [
  "courseViewLints",
  "invalidLessonCombos",
  "incompleteVideos",
] as const;

export type PublishBlockingList = (typeof PUBLISH_BLOCKING_LISTS)[number];

/** A shipping Video that has no matching `.mp4` on disk. */
export type UnexportedVideo = {
  readonly id: string;
  readonly title: string;
};

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
          // Archived videos are already filtered out of the effective output by
          // computeEffectiveSections, so they can never reach one of the four
          // outstanding-work lists —
          // skipping them here just spares a pointless stat() per archived row.
          if (video.archived) continue;
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
        // naming the outstanding videos never has to re-walk the tree.
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
    // out of every publish, but it is exactly the work still to do. The four
    // lists answer "can this ship?"; progress answers "how far along is it?".
    const progress = {
      sections: version.sections.length,
      // `unset` is not padding: authoringStatus is a nullable text column with
      // no DB default, so a Lesson can carry neither status. Counting it keeps
      // todo + done + unset === total, which is what a caller deriving
      // "remaining = total - done" needs in order not to over-count.
      lessons: { total: 0, todo: 0, done: 0, unset: 0 },
      videos: { total: 0, exported: 0, unexported: 0, noClips: 0 },
    };
    for (const section of version.sections) {
      for (const lesson of section.lessons) {
        progress.lessons.total += 1;
        if (lesson.authoringStatus === "todo") progress.lessons.todo += 1;
        else if (lesson.authoringStatus === "done") progress.lessons.done += 1;
        else progress.lessons.unset += 1;
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
