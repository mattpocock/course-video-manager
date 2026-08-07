export type VideoWarningKind =
  | "missingChapters"
  | "missingBody"
  | "missingDescription"
  /**
   * A quiz id this video shares with another. Unlike its siblings this one is
   * not computable from the video alone — see collectCourseViewLints, which
   * raises it from the whole-course walk.
   */
  | "duplicateQuizId";

export type VideoWarning = { kind: VideoWarningKind };

/** Clips and Chapters both sit on the video timeline, ordered by fractional index. */
type TimelineEntry = { order: string; archived: boolean };

/** Lowest `order` among the non-archived entries, or null when none remain. */
const firstLiveOrder = (entries: TimelineEntry[]): string | null => {
  let first: string | null = null;
  for (const entry of entries) {
    if (entry.archived) continue;
    if (first === null || entry.order < first) first = entry.order;
  }
  return first;
};

export const computeVideoWarnings = (input: {
  clips: TimelineEntry[];
  chapters: TimelineEntry[];
  /** Set when the video belongs to a lesson; only then are body/SEO required. */
  lessonId?: string | null;
  body?: string | null;
  description?: string | null;
}): VideoWarning[] => {
  const warnings: VideoWarning[] = [];

  const firstClipOrder = firstLiveOrder(input.clips);
  if (firstClipOrder !== null) {
    const firstChapterOrder = firstLiveOrder(input.chapters);
    const opensWithChapter =
      firstChapterOrder !== null && firstChapterOrder < firstClipOrder;

    if (!opensWithChapter) warnings.push({ kind: "missingChapters" });
  }

  // Lesson videos publish canonical body + SEO description, so both are
  // required. Non-lesson videos (series/tutorials) have no Lesson tab and are
  // exempt.
  if (input.lessonId != null) {
    if (!input.body?.trim()) warnings.push({ kind: "missingBody" });
    if (!input.description?.trim())
      warnings.push({ kind: "missingDescription" });
  }

  return warnings;
};
