import { Config, Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import {
  computeExportHash,
  resolveExportPath as resolveExportPathPure,
  toExportClips,
} from "./export-hash";
import { collectCourseViewLints } from "./lesson-warnings";
import {
  ANNOUNCE_NOTHING,
  classifyLessonPublishStatus,
  collectPublishBlockers,
  computeEffectiveSections,
  type LessonHardGap,
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

/**
 * Why a Lesson is withheld, in the words a reader needs: the three hard gaps
 * named one by one, plus the to-do toggle. A Lesson vanishing from a release
 * must never be a mystery, so every withheld Lesson carries one of these.
 */
export type WithheldReason = "no-videos" | "no-clips" | "no-body" | "todo";

const WITHHELD_REASON_BY_HARD_GAP: Record<LessonHardGap, WithheldReason> = {
  "no-active-video": "no-videos",
  "no-clips": "no-clips",
  "no-body": "no-body",
};

/** A Lesson this release announces as a Placeholder Lesson: title only. */
export type PlaceholderLesson = {
  readonly sectionPath: string;
  readonly lessonPath: string;
  readonly title: string;
  /** Its Lesson Priority — the band the floor let it through on. */
  readonly priority: number;
  readonly hardGaps: readonly LessonHardGap[];
};

/** A Lesson this release leaves out entirely, and why. */
export type WithheldLesson = PlaceholderLesson & {
  readonly reason: WithheldReason;
};

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
 * decides the `placeholderLessons` and `withheldLessons` lists, and it narrows
 * two gates: a gate may only speak about what a release contains, so the
 * course-view lints (every Lesson Warning and Video Warning) and the Lesson
 * role-combo check are computed over the Lessons that ship and stay silent
 * about a Placeholder Lesson. At the default announce-nothing position nothing
 * is a Placeholder Lesson, so every number is exactly what it was before the
 * floor existed.
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
      const classify = (
        lesson: (typeof version.sections)[number]["lessons"][number]
      ) =>
        classifyLessonPublishStatus(lesson, {
          includeTodoLessons,
          placeholderFloor,
        });

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

      // THE LESSONS THAT SHIP — the only Lessons a gate may speak about.
      //
      // INTERIM, and the one place this module knows the floor twice over:
      // computeEffectiveSections still fixes the floor at announce-nothing
      // internally, so it keeps a hard-gapped Lesson in the walk for the
      // blocker collector to find (ADR 0019 — a gap is still a failure
      // downstream until that changes). Dropping the Lessons this floor
      // announces is therefore the whole of the narrowing: at announce-nothing
      // nothing is dropped and these ARE the effective Sections, and once
      // computeEffectiveSections takes the floor itself, `!== "placeholder"`
      // over its output is exactly "ships".
      const shippingSections = effectiveSections
        .map((section) => ({
          ...section,
          lessons: section.lessons.filter(
            (lesson) => classify(lesson).status !== "placeholder"
          ),
        }))
        .filter((section) => section.lessons.length > 0);

      const courseViewLints = collectCourseViewLints(shippingSections);
      const courseViewLintCount = courseViewLints.length;

      // Publish blockers computed from the exact same walk buildCourseJson
      // uses (its backstop), so the pre-publish warnings and the build
      // failure can never disagree — see collectPublishBlockers.
      //
      // Two calls, on purpose, because the two lists have different reach. The
      // role-combo check is a GATE, so it sees only the Lessons that ship — a
      // duplicate role on an unfilmed Lesson cannot refuse a pre-launch
      // release. `incompleteVideos` is not narrowed: it is the record of which
      // Videos still have gaps, and it keeps the reach it has today.
      const { invalidLessonCombos } = collectPublishBlockers(
        shippingSections,
        includeTodoLessons
      );
      const { incompleteVideos } = collectPublishBlockers(
        version.sections,
        includeTodoLessons
      );

      // What this floor announces, and what it drops. One walk of the whole
      // tree rather than of the effective output, because a Lesson with no
      // Video at all never reaches the effective output and is exactly the
      // Lesson a Placeholder Lesson exists for.
      const placeholderLessons: PlaceholderLesson[] = [];
      const withheldLessons: WithheldLesson[] = [];
      for (const section of version.sections) {
        for (const lesson of section.lessons) {
          const verdict = classify(lesson);
          if (verdict.status === "ships") continue;
          const row = {
            sectionPath: section.path,
            lessonPath: lesson.path,
            title: lesson.title,
            priority: lesson.priority,
            hardGaps: verdict.hardGaps,
          };
          if (verdict.status === "placeholder") {
            placeholderLessons.push(row);
          } else {
            withheldLessons.push({
              ...row,
              reason:
                verdict.reason === "todo"
                  ? "todo"
                  : WITHHELD_REASON_BY_HARD_GAP[verdict.hardGaps[0]!],
            });
          }
        }
      }

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
