import { lessons } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "@/services/drizzle-service.server";
import { parseLessonPath } from "./lesson-path-service";

/**
 * One-off migration that populates `lesson.title` for real lessons whose title
 * predates title-driven paths (e.g. lessons imported via `createLessons`, which
 * historically stored only the numbered path). Mirrors `section-title-backfill`
 * for the lesson side: after the compute-on-read sweep, the derived folder name
 * comes from `title`, so every real lesson needs a title whose slug reproduces
 * its current folder. Ghost lessons already carry a first-class title from
 * creation and are left untouched.
 *
 * Pure `(db) => Promise<void>`, deterministic, run manually.
 */

/** Title-cases a dash-case slug ("getting-started" → "Getting Started"). */
const titleFromSlug = (slug: string): string =>
  slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export async function backfillRealLessonTitles(db: DrizzleDB) {
  const allLessons = await db
    .select({
      id: lessons.id,
      path: lessons.path,
      title: lessons.title,
      fsStatus: lessons.fsStatus,
    })
    .from(lessons)
    .where(eq(lessons.archived, false));

  for (const lesson of allLessons) {
    // Ghost lessons keep their raw human title; only real, title-less lessons
    // need recovering from the numbered path.
    if (lesson.fsStatus === "ghost") continue;
    if (lesson.title !== "") continue;

    const parsed = parseLessonPath(lesson.path);
    const slug = parsed?.slug ?? lesson.path;
    const title = titleFromSlug(slug);

    await db.update(lessons).set({ title }).where(eq(lessons.id, lesson.id));
  }
}

/**
 * Post-condition guard: no real lesson is left with a blank title whose derived
 * title (from its path slug) is non-empty. Guards the silent-miss hazard of the
 * `NOT NULL default ''` column.
 */
export async function assertNoBlankLessonTitles(db: DrizzleDB) {
  const allLessons = await db
    .select({
      id: lessons.id,
      path: lessons.path,
      title: lessons.title,
      fsStatus: lessons.fsStatus,
    })
    .from(lessons)
    .where(eq(lessons.archived, false));

  const blanks: string[] = [];
  for (const lesson of allLessons) {
    if (lesson.fsStatus === "ghost") continue;
    if (lesson.title !== "") continue;

    const parsed = parseLessonPath(lesson.path);
    const derivedTitle = titleFromSlug(parsed?.slug ?? lesson.path);
    if (derivedTitle !== "") {
      blanks.push(lesson.id);
    }
  }

  if (blanks.length > 0) {
    throw new Error(
      `Post-condition failed: ${blanks.length} real lesson(s) have blank title but a non-empty derived title: ${blanks.join(", ")}`
    );
  }
}
