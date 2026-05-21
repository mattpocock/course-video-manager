export type VideoWarningKind = "missingOpeningChapter";

export type VideoWarning = { kind: VideoWarningKind };

type WarningInputClip = { order: string; archived: boolean };
type WarningInputSection = { order: string; archived: boolean };

export const computeVideoWarnings = (input: {
  clips: WarningInputClip[];
  chapters: WarningInputSection[];
}): VideoWarning[] => {
  const liveClips = input.clips.filter((c) => !c.archived);
  if (liveClips.length === 0) return [];

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

  return opensWithSection ? [] : [{ kind: "missingOpeningChapter" }];
};
