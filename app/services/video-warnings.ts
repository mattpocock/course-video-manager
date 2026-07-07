export type VideoWarningKind =
  | "missingOpeningChapter"
  | "missingBody"
  | "missingDescription";

export type VideoWarning = { kind: VideoWarningKind };

type WarningInputClip = { order: string; archived: boolean };
type WarningInputSection = { order: string; archived: boolean };

export const computeVideoWarnings = (input: {
  clips: WarningInputClip[];
  chapters: WarningInputSection[];
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

    const liveSections = input.chapters.filter((s) => !s.archived);
    const firstSectionOrder = liveSections.length
      ? liveSections.reduce(
          (min, s) => (s.order < min ? s.order : min),
          liveSections[0]!.order
        )
      : null;

    const opensWithSection =
      firstSectionOrder !== null && firstSectionOrder < minClipOrder;

    if (!opensWithSection) warnings.push({ kind: "missingOpeningChapter" });
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
