// WHAT THIS FLOOR ANNOUNCES, AND WHAT IT DROPS.
//
// One walk of the whole version tree, classifying every Lesson with
// `classifyLessonPublishStatus` — the very same classifier `buildCourseJson`
// reads to decide the manifest's contents. That is the point of the module: the
// publish page's summary line and its two cards, and `cvm course readiness`'s
// two lists, are all this one function, so a surface can never promise a
// release the Publish does not then produce.
//
// It walks the WHOLE tree rather than the effective output, because a Lesson
// with no active Video at all reaches neither the shipping set nor the manifest
// on its own — and that Lesson is exactly what a Placeholder Lesson exists for.
//
// It is pure and filesystem-free, so a caller holding the version tree may ask
// it about as many Placeholder Floor positions as it likes. The publish page
// does exactly that: it asks about all four positions at each to-do setting, so
// moving the control moves Lessons between the two cards with no round-trip.

import {
  classifyLessonPublishStatus,
  type ClassifiableLesson,
  type LessonHardGap,
  type PlaceholderFloor,
} from "@/packages/course-json";

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

/** Every Lesson Publish Status in one release position, counted and itemised. */
export type LessonPublishStatuses = {
  /** How many Lessons ship in full. Counted, never listed: it is the norm. */
  readonly ships: number;
  readonly placeholderLessons: readonly PlaceholderLesson[];
  readonly withheldLessons: readonly WithheldLesson[];
};

type StatusInputLesson = ClassifiableLesson & {
  readonly path: string;
  readonly title: string;
};

type StatusInputSection = {
  readonly path: string;
  readonly lessons: readonly StatusInputLesson[];
};

/**
 * Classify every Lesson in the tree at one to-do setting and one Placeholder
 * Floor position. `ships` plus the two list lengths always sum to the number of
 * Lessons in the tree, so the three counts read as one whole.
 */
export const collectLessonPublishStatuses = (
  sections: readonly StatusInputSection[],
  options: {
    readonly includeTodoLessons: boolean;
    readonly placeholderFloor: PlaceholderFloor;
  }
): LessonPublishStatuses => {
  let ships = 0;
  const placeholderLessons: PlaceholderLesson[] = [];
  const withheldLessons: WithheldLesson[] = [];

  for (const section of sections) {
    for (const lesson of section.lessons) {
      const verdict = classifyLessonPublishStatus(lesson, options);
      if (verdict.status === "ships") {
        ships += 1;
        continue;
      }
      const row: PlaceholderLesson = {
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

  return { ships, placeholderLessons, withheldLessons };
};
