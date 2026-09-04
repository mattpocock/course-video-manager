/**
 * Pure functions for section path naming conventions.
 *
 * A section's display path is its slugified title (e.g. "Advanced Topics" →
 * "advanced-topics") — no ordering number. Order is carried by the `order`
 * column and by array position in `course.json`; the path exists purely for
 * filesystem legibility (the Dropbox bundle's directory layout, ADR 0023),
 * so it never needs to change when a section is reordered or when a lesson
 * moves in or out of it. Collisions between same-titled sibling sections are
 * disambiguated at the point paths are projected (`path-projection.ts`), not
 * here.
 */

import { toSlug } from "./lesson-path-service.js";

export type ParsedSectionPath = {
  sectionNumber: number;
  slug: string;
};

export const sectionHasLessons = (lessons: ReadonlyArray<unknown>): boolean =>
  lessons.length > 0;

export const deriveSectionPath = (title: string): string => {
  return toSlug(title) || "untitled";
};

/**
 * Parses a legacy numbered section directory name, for tolerating
 * old-format input when a section is created from a name that still carries
 * a number prefix ("01-intro" → { sectionNumber: 1, slug: "intro" }). Not
 * used to build or project display paths, which are never numbered.
 */
export const parseSectionPath = (
  sectionPath: string
): ParsedSectionPath | null => {
  const match = sectionPath.match(/^(\d+)-(.+)$/);
  if (!match) return null;
  return {
    sectionNumber: Number(match[1]),
    slug: match[2]!,
  };
};
