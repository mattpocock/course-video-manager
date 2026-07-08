/**
 * Pure functions for section path naming conventions.
 *
 * Format: NN-slug (e.g., 01-intro, 02-advanced)
 *   NN = section number (zero-padded to match existing width)
 */

import { toSlug } from "./lesson-path-service";

export type ParsedSectionPath = {
  sectionNumber: number;
  slug: string;
};

export const sectionHasLessons = (lessons: ReadonlyArray<unknown>): boolean =>
  lessons.length > 0;

/**
 * Derives the slug for a section regardless of whether its path is already
 * numbered ("02-concepts" → "concepts") or a plain title ("Concepts" →
 * "concepts").
 */
export const sectionSlugFromPath = (sectionPath: string): string => {
  const parsed = parseSectionPath(sectionPath);
  if (parsed) return parsed.slug;
  return toSlug(sectionPath) || "untitled";
};

export type SectionForReorder = {
  id: string;
  path: string; // directory name like "01-intro"
  hasLessons: boolean; // whether the section has lessons (not the path)
};

export type SectionRenameEntry = {
  id: string;
  oldPath: string;
  newPath: string;
  oldSectionNumber: number;
  newSectionNumber: number;
};

/**
 * Builds a section directory name in NN-slug format.
 */
export const buildSectionPath = (
  sectionNumber: number,
  slug: string
): string => {
  const num = String(sectionNumber).padStart(2, "0");
  return `${num}-${slug}`;
};

export const deriveSectionPath = (
  title: string,
  sectionNumber: number
): string => {
  return buildSectionPath(sectionNumber, toSlug(title) || "untitled");
};

/**
 * Parses a section directory name.
 *
 * "01-intro" → { sectionNumber: 1, slug: "intro" }
 * "12-advanced-topic" → { sectionNumber: 12, slug: "advanced-topic" }
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

/**
 * Given the current sections and the desired new order (as an array of IDs),
 * returns the list of renames needed to keep numbering sequential.
 *
 * @param currentSections - Sections with their current paths
 * @param newOrderIds - Section IDs in the desired new order
 * @returns Array of renames where the path actually changed
 */
export const computeSectionRenumberingPlan = (
  currentSections: SectionForReorder[],
  newOrderIds: readonly string[]
): SectionRenameEntry[] => {
  if (currentSections.length === 0 || newOrderIds.length === 0) return [];

  const sectionMap = new Map(currentSections.map((s) => [s.id, s]));

  const renames: SectionRenameEntry[] = [];
  for (let i = 0; i < newOrderIds.length; i++) {
    const section = sectionMap.get(newOrderIds[i]!);
    if (!section) continue;

    // Empty sections (no lessons) don't get numbered paths.
    if (!section.hasLessons) continue;

    const newSectionNumber = i + 1;
    const newPath = buildSectionPath(
      newSectionNumber,
      sectionSlugFromPath(section.path)
    );
    if (newPath !== section.path) {
      renames.push({
        id: section.id,
        oldPath: section.path,
        newPath,
        oldSectionNumber:
          parseSectionPath(section.path)?.sectionNumber ?? newSectionNumber,
        newSectionNumber,
      });
    }
  }

  return renames;
};
