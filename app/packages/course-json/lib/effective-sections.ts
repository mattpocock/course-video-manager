// The single home of "what this publish ships". Export, validation, the
// Dropbox mirror, and buildCourseJson all read effective Sections from here so
// there is exactly one notion of the effective output.
//
// A Lesson is *effective* iff it has at least one active (non-archived) Video
// AND it is not withheld. It is *withheld* only when to-do Lessons are excluded
// (`includeTodoLessons` is false) and the Lesson's authoring status is `todo`.
// A Section is *effective* iff it retains at least one effective Lesson.
//
// The toggle never touches the frozen Published Version snapshot — this filter
// affects only what reaches Dropbox and course.json, so withholding is fully
// reversible: flip the toggle back on (or mark the Lesson done) and republish.

type EffectiveVideo = { archived: boolean };

type EffectiveLesson = {
  authoringStatus: string | null;
  videos: readonly EffectiveVideo[];
};

type EffectiveSection<L extends EffectiveLesson> = {
  lessons: readonly L[];
};

export const isLessonWithheld = (
  authoringStatus: string | null,
  includeTodoLessons: boolean
): boolean => !includeTodoLessons && authoringStatus === "todo";

export const isLessonEffective = (
  lesson: EffectiveLesson,
  includeTodoLessons: boolean
): boolean =>
  lesson.videos.some((video) => !video.archived) &&
  !isLessonWithheld(lesson.authoringStatus, includeTodoLessons);

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
      lessons: section.lessons.filter((lesson) =>
        isLessonEffective(lesson, includeTodoLessons)
      ),
    }))
    .filter((section) => section.lessons.length > 0) as S[];
