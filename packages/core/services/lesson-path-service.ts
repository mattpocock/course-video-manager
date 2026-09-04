/**
 * Pure functions for lesson path naming conventions.
 *
 * A lesson's display path is its slugified title (e.g. "My Lesson" →
 * "my-lesson") — no ordering number. Order is carried by the `order` column
 * and by array position in `course.json`; the path exists purely for
 * filesystem legibility (the Dropbox bundle's directory layout, ADR 0023),
 * so it never needs to change when a lesson is reordered or moved between
 * sections. Collisions between same-titled sibling lessons are disambiguated
 * at the point paths are projected (`path-projection.ts`), not here.
 *
 * `parseLessonPath` still understands the legacy numbered formats
 * (`XX.YY-slug` / `XXX-slug`) so old-format input is tolerated when a lesson
 * is created from a name that still carries a number prefix.
 */

/**
 * Converts a human-readable string to a valid dash-case slug.
 * Only lowercase letters, digits, and dashes are kept.
 */
export const toSlug = (input: string): string => {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

export const deriveLessonPath = (title: string): string => {
  return toSlug(title) || "untitled";
};

export type ParsedLessonPath = {
  sectionNumber: number | undefined;
  lessonNumber: number;
  slug: string;
};

/**
 * Parses a legacy numbered lesson directory name.
 *
 * Two-digit format: "01.03-slug-name" → { sectionNumber: 1, lessonNumber: 3, slug: "slug-name" }
 * Three-digit format: "003-slug-name" → { sectionNumber: undefined, lessonNumber: 3, slug: "slug-name" }
 */
export const parseLessonPath = (
  lessonPath: string
): ParsedLessonPath | null => {
  // Two-digit format: XX.YY-slug (exactly 2 digits on each side of the dot)
  const twoDigitMatch = lessonPath.match(/^(\d{2})\.(\d{2})-(.+)$/);
  if (twoDigitMatch) {
    return {
      sectionNumber: Number(twoDigitMatch[1]),
      lessonNumber: Number(twoDigitMatch[2]),
      slug: twoDigitMatch[3]!,
    };
  }

  // Three-digit / legacy format: NNN-slug or NNN.N-slug
  const legacyMatch = lessonPath.match(/^(\d[\d.]*)-(.+)$/);
  if (legacyMatch) {
    return {
      sectionNumber: undefined,
      lessonNumber: Number(legacyMatch[1]),
      slug: legacyMatch[2]!,
    };
  }

  return null;
};
