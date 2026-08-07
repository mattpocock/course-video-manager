import { computeVideoWarnings, type VideoWarningKind } from "./video-warnings";
import {
  collectCourseQuizIdUses,
  findQuizIdCollisions,
  type VideoBody,
} from "@/features/article-writer/quiz-ids";

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

type LintVideo = {
  id?: string;
  title: string;
  archived?: boolean;
  lessonId?: string | null;
  body?: string | null;
  description?: string | null;
  clips: Array<{ order: string; archived: boolean }>;
  chapters: Array<{ order: string; archived: boolean }>;
};

type LintLesson = { path?: string; videos: LintVideo[] };
type LintSection = { path?: string; lessons: LintLesson[] };

/**
 * One course-view warning, tagged with where it lives so the publish page can
 * name it (not just count it). `scope` distinguishes a lesson-level warning
 * (an invalid video-role combo) from a video-level one (a missing chapter,
 * body, or SEO description).
 */
export type CourseViewLint =
  | {
      /**
       * A problem belonging to no single video — the first lint of this shape.
       * A duplicate quiz id is a property of a *pair* of videos, so it is
       * reported once, naming both, rather than half-reported on each.
       */
      scope: "course";
      kind: "duplicateQuizId";
      /** The id two or more videos share. */
      quizId: string;
      /** Every video using it, as `section/lesson/title`. */
      videoPaths: string[];
    }
  | {
      scope: "lesson";
      sectionPath: string;
      lessonPath: string;
      kind: LessonWarningKind;
    }
  | {
      scope: "video";
      sectionPath: string;
      lessonPath: string;
      videoTitle: string;
      kind: VideoWarningKind;
    };

/**
 * The full, itemised list of course-view warnings across a course. This is the
 * single source of truth: {@link computeCourseViewLintCount} is its length, and
 * the publish page renders each entry so a warning is never merely counted.
 */
export function collectCourseViewLints(
  sections: LintSection[]
): CourseViewLint[] {
  const lints: CourseViewLint[] = [];
  for (const section of sections) {
    const sectionPath = section.path ?? "";
    for (const lesson of section.lessons) {
      const lessonPath = lesson.path ?? "";
      // Archived videos are "deleted" — never shown in the course view and
      // never published — so they can't be the subject of a warning. Excluding
      // them here keeps this walk in step with collectPublishBlockers (which
      // lints only `activeVideos`) and with the course view's DB-level filter.
      const activeVideos = lesson.videos.filter((v) => !v.archived);
      for (const warning of computeLessonWarnings({ videos: activeVideos })) {
        lints.push({
          scope: "lesson",
          sectionPath,
          lessonPath,
          kind: warning.kind,
        });
      }
      for (const video of activeVideos) {
        const videoWarnings = computeVideoWarnings({
          clips: video.clips,
          chapters: video.chapters,
          lessonId: video.lessonId,
          body: video.body,
          description: video.description,
        });
        for (const warning of videoWarnings) {
          lints.push({
            scope: "video",
            sectionPath,
            lessonPath,
            videoTitle: video.title,
            kind: warning.kind,
          });
        }
      }
    }
  }

  for (const collision of findCourseQuizIdCollisions(sections)) {
    lints.push({
      scope: "course",
      kind: "duplicateQuizId",
      quizId: collision.id,
      videoPaths: collision.uses.map((use) => use.videoTitle),
    });
  }

  return lints;
}

/**
 * Quiz ids shared by two or more videos anywhere in the course.
 *
 * Shared with the course view, which flags each offending video row: one walk
 * so a row and the publish gate can never disagree about what clashes.
 */
export function findCourseQuizIdCollisions(sections: LintSection[]) {
  const bodies: VideoBody[] = [];
  for (const section of sections) {
    for (const lesson of section.lessons) {
      for (const video of lesson.videos) {
        if (video.archived) continue;
        bodies.push({
          videoId: video.id ?? video.title,
          // The full path, so a lint names a video the reader can find.
          videoTitle: `${section.path ?? ""}/${lesson.path ?? ""}/${video.title}`,
          body: video.body ?? null,
        });
      }
    }
  }
  return findQuizIdCollisions(collectCourseQuizIdUses(bodies));
}

export function computeCourseViewLintCount(sections: LintSection[]): number {
  return collectCourseViewLints(sections).length;
}
