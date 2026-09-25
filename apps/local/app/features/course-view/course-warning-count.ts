/**
 * The fields the count reads — a structural subset of `Section`, so a test can
 * build one warning-bearing Section without the whole loader tree.
 */
type WarningBearingSection = {
  learningGoals?: readonly { readonly warnings?: readonly unknown[] }[];
  lessons: readonly {
    readonly lessonWarnings?: readonly unknown[];
    readonly videos: readonly {
      readonly warnings: readonly unknown[];
      readonly beats?: readonly { readonly warnings?: readonly unknown[] }[];
    }[];
  }[];
};

/**
 * Every authoring warning the course view's tree carries: the Learning Goal
 * Warnings on a Section, the lesson-level ones, the Beat Warnings on a Video's
 * Beats, and the video-level ones the Autofill does not own (see
 * `authoringVideoWarnings`).
 *
 * Counted whatever the Course View Display Settings currently hide — a
 * collapsed Section and a switched-off Beat Learning Goal control both hide a
 * triangle without making the work go away.
 *
 * This badge deliberately reads LOWER than the publish page's blocker count:
 * the missing description and the missing Chapters are still blocking there,
 * they are just no longer Matt's work (ADR 0024).
 */
export function countCourseWarnings(
  sections: readonly WarningBearingSection[]
): number {
  let count = 0;
  for (const section of sections) {
    for (const goal of section.learningGoals ?? []) {
      count += goal.warnings?.length ?? 0;
    }
    for (const lesson of section.lessons) {
      count += lesson.lessonWarnings?.length ?? 0;
      for (const video of lesson.videos) {
        count += video.warnings.length;
        for (const beat of video.beats ?? []) {
          count += beat.warnings?.length ?? 0;
        }
      }
    }
  }
  return count;
}
