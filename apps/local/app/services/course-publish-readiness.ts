import { Config, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import {
  computeExportHash,
  resolveExportPath as resolveExportPathPure,
  toExportClips,
} from "./export-hash";
import { collectCourseViewLints } from "./lesson-warnings";
import { collectLessonPublishStatuses } from "./course-publish-lesson-statuses";
import {
  ANNOUNCE_NOTHING,
  collectPublishBlockers,
  computeShippingSections,
  type PlaceholderFloor,
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
 *                         course.json build, so the publish still cannot land.
 *   incompleteVideos      Enumerated over the SHIPPING Lessons only, so since
 *                         ADR 0029 this means a missing `description`. It still
 *                         FAILS the course.json build (see
 *                         IncompleteShippingVideoError), and the courseViewLints
 *                         gate above refuses it earlier, before any byte is
 *                         uploaded.
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

/**
 * The Lesson Publish Status lists, re-exported from the pure walk that decides
 * them (./course-publish-lesson-statuses) so a caller reading Publish Readiness
 * names them without reaching past this module.
 */
export type {
  WithheldReason,
  PlaceholderLesson,
  WithheldLesson,
} from "./course-publish-lesson-statuses";

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
 *
 * `placeholderFloor` answers the other half of the question — "if I set the
 * floor here, what would this release announce, and what would it drop?". It
 * decides the `placeholderLessons` and `withheldLessons` lists, and nothing
 * else: every gate here reads `computeShippingSections`, which the floor cannot
 * move a Lesson into or out of (it only ever turns a withheld Lesson into a
 * Placeholder Lesson). So the four outstanding-work lists are
 * floor-INDEPENDENT, and asking about a floor can never change the answer to
 * "can this ship?". A gate may only speak about what a release contains, so the
 * course-view lints (every Lesson Warning and Video Warning), the Lesson
 * role-combo check and the incomplete-Video record all stay silent about a
 * Lesson the release does not ship in full.
 */
export const validatePublishability = Effect.fn("validatePublishability")(
  function* (
    versionId: string,
    placeholderFloor: PlaceholderFloor = ANNOUNCE_NOTHING
  ) {
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
          // Archived videos are already filtered out of the shipping set by
          // computeShippingSections, so they can never reach one of the four
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
      // THE LESSONS THAT SHIP — the asset set, and the only Lessons a gate may
      // speak about. Floor-independent by construction (see
      // computeShippingSections), and the very same walk `course publish` uses
      // to build its export roster, so `exportsRequired` can never name a
      // Video that publish would not render.
      const shippingSections = computeShippingSections(
        version.sections,
        includeTodoLessons
      );

      const unexportedVideoIds: string[] = [];
      for (const section of shippingSections) {
        for (const lesson of section.lessons) {
          for (const video of lesson.videos) {
            if (exportedById.get(video.id) === false) {
              unexportedVideoIds.push(video.id);
            }
          }
        }
      }

      const courseViewLints = collectCourseViewLints(shippingSections);
      const courseViewLintCount = courseViewLints.length;

      // Publish blockers computed from the exact same walk buildCourseJson
      // uses (its backstop), so the pre-publish warnings and the build
      // failure can never disagree — see collectPublishBlockers. It narrows to
      // the shipping Lessons itself, so the whole tree is the right argument:
      // both lists come back already silent about a Placeholder Lesson.
      const { invalidLessonCombos, incompleteVideos } = collectPublishBlockers(
        version.sections,
        includeTodoLessons
      );

      // What this floor announces, and what it drops — the one walk the publish
      // page reads too, so the cards and the manifest cannot disagree.
      const { ships, placeholderLessons, withheldLessons } =
        collectLessonPublishStatuses(version.sections, {
          includeTodoLessons,
          placeholderFloor,
        });

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
        // The three Lesson Publish Status counts, so a caller that publishes
        // can report what it announced and what it withheld without walking the
        // tree a second time. `ships` plus the two list lengths is every Lesson
        // in the version tree.
        ships,
        placeholderLessons,
        withheldLessons,
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
