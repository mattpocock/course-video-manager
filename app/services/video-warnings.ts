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

/**
 * The warnings the **Autofill** owns, each paired with the field one press
 * writes to clear it. They stay exactly as blocking inside **Publish
 * Readiness** — a Video whose Autofill failed still cannot ship — but they are
 * no longer authoring tasks, so the authoring surfaces (the course view, the
 * **Section Workbench**, the video editor) do not nag about them. Only where
 * they are shown changes; what they mean does not.
 *
 * The pairing lives here so that "which warnings are the Autofill's" and
 * "which field clears each" are one fact, read by the authoring filter below
 * and by the publish page's accordion.
 */
export const AUTOFILL_OWNED_WARNINGS = {
  missingChapters: "chapters",
  missingDescription: "description",
} as const satisfies Partial<Record<VideoWarningKind, string>>;

/** The two fields the Autofill owns. */
export type AutofillField =
  (typeof AUTOFILL_OWNED_WARNINGS)[keyof typeof AUTOFILL_OWNED_WARNINGS];

/**
 * The field one Autofill press writes to clear this warning, or `undefined`
 * for the kinds no Autofill can clear.
 */
export const autofillFieldClearing = (
  kind: VideoWarningKind
): AutofillField | undefined =>
  (AUTOFILL_OWNED_WARNINGS as Partial<Record<VideoWarningKind, AutofillField>>)[
    kind
  ];

/**
 * The subset of a Video's warnings that is still Matt's work. Every other kind
 * — a missing **Body**, the per-**Clip** text-similarity danger — is untouched
 * and keeps nagging, because no Autofill clears them.
 */
export const authoringVideoWarnings = (
  warnings: readonly VideoWarning[]
): VideoWarning[] =>
  warnings.filter(
    (warning) => autofillFieldClearing(warning.kind) === undefined
  );

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
