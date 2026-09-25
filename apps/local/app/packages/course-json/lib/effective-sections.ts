// The single home of "what this publish ships". Export, validation, the
// Dropbox mirror, and buildCourseJson all read their Sections from here so
// there is exactly one notion of the effective output.
//
// The verdict itself is not decided here: every Lesson is classified by
// `classifyLessonPublishStatus` (./lesson-publish-status), the one place a
// Lesson's Lesson Publish Status is computed. These walks only apply the
// verdict to the tree — they keep the Lessons a caller cares about, strip
// archived Videos from them, and elide a Section left with nothing.
//
// TWO WALKS, because a release has two different sets in it:
//
//   computeEffectiveSections — every Lesson the release REACHES: the ones that
//     ship in full plus the ones announced as Placeholder Lessons. This is the
//     manifest's tree. It needs the Placeholder Floor, because the floor is
//     what decides whether an unshippable Lesson is announced or withheld.
//
//   computeShippingSections — only the Lessons that ship IN FULL. This is the
//     asset set: the .mp4 files uploaded, the Videos exported, the Videos
//     Autofill counts, and the Videos gap-checked. It takes no floor, because
//     the floor can only ever turn a withheld Lesson into a Placeholder Lesson
//     — it never makes an unshippable Lesson ship, so the shipping set is
//     floor-independent by construction.
//
// The toggle never touches the frozen Published Version snapshot — these
// filters affect only what reaches Dropbox and course.json, so withholding is
// fully reversible: flip the toggle back on (or mark the Lesson done) and
// republish.

import {
  ANNOUNCE_NOTHING,
  classifyLessonPublishStatus,
  type ClassifiableLesson,
  type PlaceholderFloor,
} from "./lesson-publish-status";

type EffectiveLesson = ClassifiableLesson;

type EffectiveSection<L extends EffectiveLesson> = {
  lessons: readonly L[];
};

// One walk, parameterised by which verdicts survive it. Generic and
// field-preserving: a caller's own row shape comes back out with every other
// field intact, so nothing downstream has to re-join the tree.
const filterSections = <
  L extends EffectiveLesson,
  S extends EffectiveSection<L>,
>(
  sections: readonly S[],
  includeTodoLessons: boolean,
  placeholderFloor: PlaceholderFloor,
  keep: (status: "ships" | "placeholder" | "withheld") => boolean
): S[] =>
  sections
    .map((section) => ({
      ...section,
      lessons: section.lessons
        .filter((lesson) =>
          keep(
            classifyLessonPublishStatus(lesson, {
              includeTodoLessons,
              placeholderFloor,
            }).status
          )
        )
        .map((lesson) => ({
          ...lesson,
          videos: lesson.videos.filter((video) => !video.archived),
        })),
    }))
    .filter((section) => section.lessons.length > 0) as S[];

/**
 * Every Lesson this release reaches — the ones that ship in full and the ones
 * announced as Placeholder Lessons. A Section left with neither is elided, so
 * the manifest never grows an empty node; a Section whose every Lesson is a
 * Placeholder Lesson survives, because a whole unfilmed part of the Course is
 * exactly what a pre-launch release announces.
 */
export const computeEffectiveSections = <
  L extends EffectiveLesson,
  S extends EffectiveSection<L>,
>(
  sections: readonly S[],
  includeTodoLessons: boolean,
  placeholderFloor: PlaceholderFloor
): S[] =>
  filterSections(
    sections,
    includeTodoLessons,
    placeholderFloor,
    (status) => status !== "withheld"
  );

/**
 * Only the Lessons that ship in full — the release's asset set. A Placeholder
 * Lesson contributes no .mp4, so its Videos must be absent from here or Publish
 * would export and upload a file no manifest names.
 */
export const computeShippingSections = <
  L extends EffectiveLesson,
  S extends EffectiveSection<L>,
>(
  sections: readonly S[],
  includeTodoLessons: boolean
): S[] =>
  filterSections(
    sections,
    includeTodoLessons,
    // Irrelevant by construction: the floor only ever moves a Lesson between
    // `withheld` and `placeholder`, and neither survives this filter.
    ANNOUNCE_NOTHING,
    (status) => status === "ships"
  );
