import type { LessonWarning } from "@/services/lesson-warnings";

export const LESSON_WARNING_LABELS: Record<LessonWarning["kind"], string> = {
  solutionWithoutProblem: "Solution without a Problem video",
  explainerBesideProblem: "Explainer beside a Problem video",
  duplicateRoles: "Duplicate video roles",
  numberedRoleName:
    "Numbered role name (a lesson has one video per role — name it e.g. “Explainer”, not “Explainer 2”)",
  tooManyVideos: "Too many videos on this lesson",
};

export function lessonWarningLabel(warnings: LessonWarning[]): string {
  return warnings.map((w) => LESSON_WARNING_LABELS[w.kind]).join("; ");
}
