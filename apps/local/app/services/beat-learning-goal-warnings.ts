/**
 * Beat <-> Learning Goal dependency warnings.
 *
 * Every Beat is expected to serve at least one Learning Goal of its Section
 * (see CONTEXT.md's Beat / Learning Goal entries) — but ONLY once the Section
 * has any Learning Goals at all. A Section with none yet (or a standalone /
 * pitch-bound Video with no Section) is exempt: there is nothing to serve, so
 * neither warning fires. Mirrors the shape of video-warnings.ts /
 * lesson-warnings.ts — pure, derived, never stored — but deliberately kept
 * OUT of `collectCourseViewLints` / Publish Readiness: this is a planning-
 * stage nag on in-app-only fields (a Beat is never published), not a
 * publish blocker. See course-view-loader.server.ts for where these are
 * computed and attached.
 */

export type LearningGoalWarningKind = "noBeats";
export type LearningGoalWarning = { kind: LearningGoalWarningKind };

export type BeatWarningKind = "noLearningGoal";
export type BeatWarning = { kind: BeatWarningKind };

export const LEARNING_GOAL_WARNING_LABELS: Record<
  LearningGoalWarningKind,
  string
> = {
  noBeats: "No Beat serves this Learning Goal yet",
};

export const BEAT_WARNING_LABELS: Record<BeatWarningKind, string> = {
  noLearningGoal: "Serves no Learning Goal",
};

/** Whether a Section has any (non-archived) Learning Goals to serve. */
export const sectionHasLearningGoals = (
  learningGoals: readonly { id: string }[]
): boolean => learningGoals.length > 0;

/**
 * A Learning Goal warns when the Section has Learning Goals (checked by the
 * caller — see {@link sectionHasLearningGoals}) and no Beat anywhere in the
 * Section lists it among the Learning Goals it serves.
 */
export const computeLearningGoalWarnings = (input: {
  learningGoalId: string;
  /** Every Beat in the Learning Goal's Section, across all its Lessons/Videos. */
  beats: readonly { learningGoalIds: readonly string[] }[];
}): LearningGoalWarning[] => {
  const isServed = input.beats.some((beat) =>
    beat.learningGoalIds.includes(input.learningGoalId)
  );
  return isServed ? [] : [{ kind: "noBeats" }];
};

/**
 * A Beat warns when its Section has Learning Goals but the Beat serves none
 * of them. A Beat whose Video has no Section (standalone / pitch-bound) is
 * never passed `sectionHasLearningGoals: true`, so it never warns.
 */
export const computeBeatWarnings = (input: {
  sectionHasLearningGoals: boolean;
  learningGoalIds: readonly string[];
}): BeatWarning[] => {
  if (!input.sectionHasLearningGoals) return [];
  return input.learningGoalIds.length === 0 ? [{ kind: "noLearningGoal" }] : [];
};
