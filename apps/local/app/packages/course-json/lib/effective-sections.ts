// The single home of "what this publish ships". Export, validation, the
// Dropbox mirror, and buildCourseJson all read effective Sections from here so
// there is exactly one notion of the effective output.
//
// The verdict itself is not decided here: every Lesson is classified by
// `classifyLessonPublishStatus` (./lesson-publish-status), the one place a
// Lesson's Lesson Publish Status is computed. This walk only applies the
// verdict to the tree — it keeps the Lessons this Publish reaches, strips
// archived Videos from them, and elides a Section left with nothing.
//
// The toggle never touches the frozen Published Version snapshot — this filter
// affects only what reaches Dropbox and course.json, so withholding is fully
// reversible: flip the toggle back on (or mark the Lesson done) and republish.

import {
  ANNOUNCE_NOTHING,
  classifyLessonPublishStatus,
  type ClassifiableLesson,
  type LessonPublishStatus,
} from "./lesson-publish-status";

type EffectiveLesson = ClassifiableLesson;

type EffectiveSection<L extends EffectiveLesson> = {
  lessons: readonly L[];
};

// INTERIM. A hard gap does not elide a Lesson yet: today a gapped Video is a
// release-stopping failure raised downstream by `collectPublishBlockers` (ADR
// 0019), not an absence, so the walk must still hand those Lessons on for the
// blocker collector to find. Only the oldest hard gap — the Lesson has no
// active Video at all — elides, exactly as it does today.
//
// Once a hard gap decides a Placeholder Lesson instead of a failure, this
// collapses to `verdict.status !== "withheld"`.
const reachesThisPublish = (verdict: LessonPublishStatus): boolean =>
  verdict.status !== "withheld" ||
  (verdict.reason === "hard-gap" &&
    !verdict.hardGaps.includes("no-active-video"));

export const computeEffectiveSections = <
  L extends EffectiveLesson,
  S extends EffectiveSection<L>,
>(
  sections: readonly S[],
  includeTodoLessons: boolean
): S[] =>
  sections
    .map((section) => ({
      ...section,
      lessons: section.lessons
        .filter((lesson) =>
          reachesThisPublish(
            classifyLessonPublishStatus(lesson, {
              includeTodoLessons,
              // The floor is fixed here until the surfaces can set it, so this
              // walk ships exactly what it shipped before the classifier landed.
              placeholderFloor: ANNOUNCE_NOTHING,
            })
          )
        )
        .map((lesson) => ({
          ...lesson,
          videos: lesson.videos.filter((video) => !video.archived),
        })),
    }))
    .filter((section) => section.lessons.length > 0) as S[];
