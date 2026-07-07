import { lessons } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "@/services/drizzle-service.server";

/**
 * One-off migration that populates `lesson.title` for real lessons whose title
 * predates title-driven paths (e.g. lessons imported via `createLessons`, which
 * historically stored only the numbered path). Mirrors `section-title-backfill`
 * for the lesson side: after the compute-on-read sweep, the derived folder name
 * comes from `title`, so every real lesson needs a title whose slug reproduces
 * its current folder. Ghost lessons already carry a first-class title from
 * creation and are left untouched.
 *
 * With `lessons.path` removed from the schema, this backfill is a no-op: every
 * lesson already has its title populated at creation time. The function is kept
 * for historical compatibility but does nothing when no blank titles exist.
 *
 * Pure `(db) => Promise<void>`, deterministic, run manually.
 */

export async function backfillRealLessonTitles(db: DrizzleDB) {
  const allLessons = await db
    .select({
      id: lessons.id,
      title: lessons.title,
      fsStatus: lessons.fsStatus,
    })
    .from(lessons)
    .where(eq(lessons.archived, false));

  for (const lesson of allLessons) {
    // Ghost lessons keep their raw human title; only real, title-less lessons
    // need a title. With `path` removed from the schema, there is no path to
    // derive a title from — blank titles are an error condition.
    if (lesson.fsStatus === "ghost") continue;
    if (lesson.title !== "") continue;

    // No path column to derive from; leave blank titles untouched.
    // assertNoBlankLessonTitles will flag these as errors.
  }
}

/**
 * Post-condition guard: no real lesson is left with a blank title.
 * Guards the silent-miss hazard of the `NOT NULL default ''` column.
 */
export async function assertNoBlankLessonTitles(db: DrizzleDB) {
  const allLessons = await db
    .select({
      id: lessons.id,
      title: lessons.title,
      fsStatus: lessons.fsStatus,
    })
    .from(lessons)
    .where(eq(lessons.archived, false));

  const blanks: string[] = [];
  for (const lesson of allLessons) {
    if (lesson.fsStatus === "ghost") continue;
    if (lesson.title !== "") continue;
    blanks.push(lesson.id);
  }

  if (blanks.length > 0) {
    throw new Error(
      `Post-condition failed: ${blanks.length} real lesson(s) have blank title: ${blanks.join(", ")}`
    );
  }
}
