/**
 * Pure functions for lesson path naming conventions.
 *
 * New format: XX.YY-slug (e.g., 01.03-my-lesson)
 *   XX = section number, YY = lesson number (both 2-digit zero-padded)
 *
 * Legacy format: XXX-slug (e.g., 003-my-lesson)
 *   XXX = lesson number only (3-digit zero-padded)
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

/**
 * Builds a lesson directory name in XX.YY-slug format.
 */
export const buildLessonPath = (
  sectionNumber: number,
  lessonNumber: number,
  slug: string
): string => {
  const section = String(sectionNumber).padStart(2, "0");
  const lesson = String(lessonNumber).padStart(2, "0");
  return `${section}.${lesson}-${slug}`;
};

export const deriveLessonPath = (
  title: string,
  sectionNumber: number,
  lessonNumber: number
): string => {
  return buildLessonPath(
    sectionNumber,
    lessonNumber,
    toSlug(title) || "untitled"
  );
};

export type ParsedLessonPath = {
  sectionNumber: number | undefined;
  lessonNumber: number;
  slug: string;
};

/**
 * Parses a lesson directory name.
 *
 * Two-digit format: "01.03-slug-name" → { sectionNumber: 1, lessonNumber: 3, slug: "slug-name" }
 * Three-digit format: "003-slug-name" → { sectionNumber: undefined, lessonNumber: 3, slug: "slug-name" }
 */
export type LessonForReorder = {
  id: string;
  path: string; // directory name like "01.03-my-lesson"
};

export type RenameEntry = {
  id: string;
  oldPath: string;
  newPath: string;
};

/**
 * Given the current lessons in a section and the desired new order (as an array of IDs),
 * returns the list of renames needed to keep numbering sequential.
 *
 * @param currentLessons - Lessons with their current paths
 * @param newOrderIds - Lesson IDs in the desired new order
 * @returns Array of renames where the path actually changed
 */
export const computeRenumberingPlan = (
  currentLessons: LessonForReorder[],
  newOrderIds: readonly string[]
): RenameEntry[] => {
  if (currentLessons.length === 0 || newOrderIds.length === 0) return [];

  const lessonMap = new Map(currentLessons.map((l) => [l.id, l]));

  // Determine section number from the first parseable lesson
  let sectionNumber = 1;
  for (const lesson of currentLessons) {
    const parsed = parseLessonPath(lesson.path);
    if (parsed?.sectionNumber != null) {
      sectionNumber = parsed.sectionNumber;
      break;
    }
  }

  // Compute new paths based on the provided order
  const renames: RenameEntry[] = [];
  for (let i = 0; i < newOrderIds.length; i++) {
    const lesson = lessonMap.get(newOrderIds[i]!);
    if (!lesson) continue;

    const parsed = parseLessonPath(lesson.path);
    if (!parsed) continue;

    const newPath = buildLessonPath(sectionNumber, i + 1, parsed.slug);
    if (newPath !== lesson.path) {
      renames.push({ id: lesson.id, oldPath: lesson.path, newPath });
    }
  }

  return renames;
};

/**
 * Given the existing real lessons in a section and a desired insert position,
 * returns the new lesson's directory name and any renames needed to shift
 * subsequent lessons.
 */
export const computeInsertionPlan = (opts: {
  existingRealLessons: LessonForReorder[];
  insertAtIndex: number;
  sectionNumber: number;
  slug: string;
}): {
  newLessonDirName: string;
  newLessonNumber: number;
  renames: RenameEntry[];
} => {
  const { existingRealLessons, insertAtIndex, sectionNumber, slug } = opts;

  const newLessonNumber = insertAtIndex + 1;
  const newLessonDirName = buildLessonPath(
    sectionNumber,
    newLessonNumber,
    slug
  );

  const renames: RenameEntry[] = [];
  for (let i = insertAtIndex; i < existingRealLessons.length; i++) {
    const lesson = existingRealLessons[i]!;
    const parsed = parseLessonPath(lesson.path);
    if (!parsed) continue;

    const newPath = buildLessonPath(sectionNumber, i + 2, parsed.slug);
    if (newPath !== lesson.path) {
      renames.push({ id: lesson.id, oldPath: lesson.path, newPath });
    }
  }

  return { newLessonDirName, newLessonNumber, renames };
};

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
