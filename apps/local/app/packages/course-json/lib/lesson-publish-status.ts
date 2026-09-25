// LESSON PUBLISH STATUS — the one verdict on what a Publish does with a Lesson.
//
// A Lesson's outcome is three-valued: it `ships` in full, it ships as a
// Placeholder Lesson (title only, no Video), or it is `withheld` from the
// release entirely. Every consumer of the effective output reads this one
// classifier, so the numbers on the publish page and the contents of the
// manifest are decided by the same walk and can never disagree.
//
// A HARD GAP is a gap Autofill cannot close. There are exactly three: the
// Lesson has no active Video, a Video has no Clips, a Video has no `body`. A
// missing `description` and missing Chapters are NOT hard gaps, because
// Autofill writes both — a gap Autofill can close never makes a Lesson a
// Placeholder Lesson. An Unexported Video is not a gap either, because Publish
// renders it as its export stage.
//
// A Lesson is all-or-nothing: one hard gap on any active Video gives the whole
// Lesson the status `placeholder`. A Lesson that simply holds no solution Video
// keeps shipping as it does today, so an absent `solution` keeps its one
// meaning.
//
// Precedence: the Placeholder Floor beats the to-do toggle inside the bands it
// names. Read it as "withhold to-do Lessons, except announce the P1s and P2s".
// Outside those bands the toggle keeps its own remaining job — withholding a
// Lesson that is shippable but not yet marked done — and it is named as the
// reason whenever it is the control that withheld the Lesson, because that is
// the control the author can flip. The hard gaps travel on the verdict either
// way, so a withheld Lesson can always say what is wrong with it too.

/**
 * The lowest Lesson Priority band whose unshippable Lessons ship as Placeholder
 * Lessons. Four positions: announce nothing (`null`, the default), P1, P2, P3.
 * The comparison is numeric — `priority <= floor` — so a Priority outside 1–3
 * simply sorts where its number puts it. No migration, no new failure.
 */
export type PlaceholderFloor = null | 1 | 2 | 3;

/** The floor's default position: this release announces nothing. */
export const ANNOUNCE_NOTHING: PlaceholderFloor = null;

/** A gap Autofill cannot close, and so the only kind that decides a status. */
export type LessonHardGap = "no-active-video" | "no-clips" | "no-body";

/**
 * Why a Lesson is withheld — the two reasons, never one: it has a hard gap and
 * sits below the floor, or the to-do toggle withholds it.
 */
export type LessonWithheldReason = "hard-gap" | "todo";

/**
 * The verdict. `withheld` always carries its reason, because a Lesson vanishing
 * from a release must never be a mystery.
 */
export type LessonPublishStatus =
  | { readonly status: "ships" }
  | {
      readonly status: "placeholder";
      readonly hardGaps: readonly LessonHardGap[];
    }
  | {
      readonly status: "withheld";
      readonly reason: LessonWithheldReason;
      readonly hardGaps: readonly LessonHardGap[];
    };

/**
 * Structurally minimal, so any caller's row shape satisfies it: only the fields
 * a hard gap or the floor is decided from. `clips` is read for its length only.
 */
export type ClassifiableVideo = {
  readonly archived: boolean;
  readonly body: string | null;
  readonly clips: readonly unknown[];
};

export type ClassifiableLesson = {
  readonly authoringStatus: string | null;
  readonly priority: number;
  readonly videos: readonly ClassifiableVideo[];
};

export type ClassifyLessonOptions = {
  readonly includeTodoLessons: boolean;
  readonly placeholderFloor: PlaceholderFloor;
};

/** Every hard gap on the Lesson, in a stable order. Empty means shippable. */
export const lessonHardGaps = (
  lesson: ClassifiableLesson
): readonly LessonHardGap[] => {
  const activeVideos = lesson.videos.filter((video) => !video.archived);
  if (activeVideos.length === 0) return ["no-active-video"];

  const gaps: LessonHardGap[] = [];
  if (activeVideos.some((video) => video.clips.length === 0)) {
    gaps.push("no-clips");
  }
  if (activeVideos.some((video) => video.body === null)) {
    gaps.push("no-body");
  }
  return gaps;
};

/** Whether the floor's named bands reach this Lesson's Priority. */
const isAnnouncedByFloor = (
  priority: number,
  placeholderFloor: PlaceholderFloor
): boolean => placeholderFloor !== null && priority <= placeholderFloor;

/**
 * The single classifier. Given a Lesson, the to-do setting and the Placeholder
 * Floor, decide what this Publish does with it.
 */
export const classifyLessonPublishStatus = (
  lesson: ClassifiableLesson,
  options: ClassifyLessonOptions
): LessonPublishStatus => {
  const hardGaps = lessonHardGaps(lesson);

  // The floor wins outright inside the bands it names: a gapped Lesson there is
  // announced whatever the toggle says.
  if (
    hardGaps.length > 0 &&
    isAnnouncedByFloor(lesson.priority, options.placeholderFloor)
  ) {
    return { status: "placeholder", hardGaps };
  }

  if (!options.includeTodoLessons && lesson.authoringStatus === "todo") {
    return { status: "withheld", reason: "todo", hardGaps };
  }

  if (hardGaps.length > 0) {
    return { status: "withheld", reason: "hard-gap", hardGaps };
  }

  return { status: "ships" };
};
