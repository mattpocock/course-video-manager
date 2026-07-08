import { computeVideoWarnings } from "./video-warnings";

export type LessonWarningKind =
  | "solutionWithoutProblem"
  | "explainerBesideProblem"
  | "duplicateRoles"
  | "numberedRoleName"
  | "tooManyVideos";

export type LessonWarning = { kind: LessonWarningKind };

type VideoInput = { title: string };

export type VideoRole = "explainer" | "problem" | "solution" | "unknown";

export function deriveVideoRole(videoTitle: string): VideoRole {
  const lower = videoTitle.toLowerCase();
  if (lower === "explainer" || lower.startsWith("explainer "))
    return "explainer";
  if (lower === "problem" || lower.startsWith("problem ")) return "problem";
  if (lower === "solution" || lower.startsWith("solution ")) return "solution";
  return "unknown";
}

/**
 * Whether a recognized role name carries a numeric suffix ("Explainer 2").
 * A lesson holds exactly one video per role, so the canonical name is the bare
 * role ("Explainer") — any number is a mistake, whether or not siblings exist.
 */
export function hasNumberedRoleName(videoTitle: string): boolean {
  if (deriveVideoRole(videoTitle) === "unknown") return false;
  return /\s\d+\s*$/.test(videoTitle);
}

export const computeLessonWarnings = (input: {
  videos: VideoInput[];
}): LessonWarning[] => {
  const { videos } = input;
  if (videos.length === 0) return [];

  const warnings: LessonWarning[] = [];
  const roles = videos.map((v) => deriveVideoRole(v.title));

  // A lesson holds exactly one video per role, so a role name should never be
  // numbered ("Explainer 2"). The number itself is the error — it implies a
  // second video of that role, which the lesson model can't hold.
  if (videos.some((v) => hasNumberedRoleName(v.title))) {
    warnings.push({ kind: "numberedRoleName" });
  }

  if (videos.length > 2) {
    warnings.push({ kind: "tooManyVideos" });
    return warnings;
  }

  const hasExplainer = roles.includes("explainer");
  const hasProblem = roles.includes("problem");
  const hasSolution = roles.includes("solution");

  if (hasSolution && !hasProblem) {
    warnings.push({ kind: "solutionWithoutProblem" });
  }

  if (hasExplainer && hasProblem) {
    warnings.push({ kind: "explainerBesideProblem" });
  }

  const roleCounts = new Map<VideoRole, number>();
  for (const role of roles) {
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  for (const [role, count] of roleCounts) {
    if (role !== "unknown" && count > 1) {
      warnings.push({ kind: "duplicateRoles" });
      break;
    }
  }

  return warnings;
};

type LintLesson = {
  videos: Array<{
    title: string;
    lessonId?: string | null;
    body?: string | null;
    description?: string | null;
    clips: Array<{ order: string; archived: boolean }>;
    chapters: Array<{ order: string; archived: boolean }>;
  }>;
};

export function computeCourseViewLintCount(
  sections: { lessons: LintLesson[] }[]
): number {
  let count = 0;
  for (const section of sections) {
    for (const lesson of section.lessons) {
      count += computeLessonWarnings({ videos: lesson.videos }).length;
      for (const video of lesson.videos) {
        count += computeVideoWarnings({
          clips: video.clips,
          chapters: video.chapters,
          lessonId: video.lessonId,
          body: video.body,
          description: video.description,
        }).length;
      }
    }
  }
  return count;
}
