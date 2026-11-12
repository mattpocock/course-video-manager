import type { Mode } from "./types";
import type { VideoRole } from "@/services/lesson-warnings";
import { removeQuizBlocks } from "./quiz-syntax";

export type WriterFieldId =
  | "ai-hero-body"
  | "skills-changelog-body"
  | "newsletter-copy"
  | "video-body"
  | "video-description"
  | "video-script";

export const FIELD_MODES: Record<WriterFieldId, Mode[]> = {
  "ai-hero-body": ["article", "article-plan"],
  "skills-changelog-body": ["article", "article-plan"],
  "newsletter-copy": ["newsletter"],
  // One mode per lesson role, each opened by its own role (see
  // `defaultModeForRole`), and Article for a standalone video.
  "video-body": ["problem", "explainer", "solution", "article"],
  "video-description": ["seo-description-document"],
  // No AI generation modes yet — the script is authored manually. Beat→script
  // generation is a follow-up (course-video-manager#1421); the field still gets
  // the full WritableField editing experience today.
  "video-script": [],
};

export const FIELD_LABELS: Record<WriterFieldId, string> = {
  "ai-hero-body": "AI Hero Body",
  "skills-changelog-body": "Skills Changelog Body",
  "newsletter-copy": "Newsletter Copy",
  "video-body": "Lesson Body",
  "video-description": "SEO Description",
  "video-script": "Script",
};

export function constrainModes(
  modes: Mode[],
  currentMode: Mode
): { mode: Mode; isConstrained: boolean } {
  if (modes.length === 0) return { mode: currentMode, isConstrained: false };
  if (modes.includes(currentMode))
    return { mode: currentMode, isConstrained: true };
  return { mode: modes[0]!, isConstrained: true };
}

/**
 * The mode the writer opens on, from the video's role in its lesson: each
 * lesson role has a mode of its own, and a standalone video opens on article.
 * Pass the result through {@link constrainModes}: a field that doesn't offer
 * the role's mode still lands on its own first mode.
 */
export function defaultModeForRole(role: VideoRole | undefined): Mode {
  return role === undefined || role === "unknown" ? "article" : role;
}

/**
 * The document as it is saved on Apply. A Solution never holds a quiz, so in
 * solution mode every quiz block is cut, whoever wrote it.
 */
export function documentToApply(mode: Mode, document: string): string {
  return mode === "solution" ? removeQuizBlocks(document) : document;
}
