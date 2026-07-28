export type VideoWarningKind =
  "missingChapters" | "missingBody" | "missingDescription";

export type VideoWarning = { kind: VideoWarningKind };

type WarningInputClip = { order: string; archived: boolean };
type WarningInputChapter = { order: string; archived: boolean };

export const computeVideoWarnings = (input: {
  clips: WarningInputClip[];
  chapters: WarningInputChapter[];
  /** Set when the video belongs to a lesson; only then are body/SEO required. */
  lessonId?: string | null;
  body?: string | null;
  description?: string | null;
}): VideoWarning[] => {
  const warnings: VideoWarning[] = [];

  const liveClips = input.clips.filter((c) => !c.archived);
  if (liveClips.length > 0) {
    const minClipOrder = liveClips.reduce(
      (min, c) => (c.order < min ? c.order : min),
      liveClips[0]!.order
    );

    const liveChapters = input.chapters.filter((c) => !c.archived);
    const firstChapterOrder = liveChapters.length
      ? liveChapters.reduce(
          (min, c) => (c.order < min ? c.order : min),
          liveChapters[0]!.order
        )
      : null;

    const opensWithChapter =
      firstChapterOrder !== null && firstChapterOrder < minClipOrder;

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
