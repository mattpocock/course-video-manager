import { sections, lessons } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "@/services/drizzle-service.server";
import {
  sectionSlugFromPath,
  sectionHasRealLessons,
} from "./section-path-service";

/**
 * Title-cases a dash-case slug ("before-we-start" → "Before We Start"). Local
 * to this one-off migration: the lossy slug→title round-trip is deleted from
 * the authoring model, but the backfill legitimately recovers a title from the
 * only record a legacy real section has — its numbered path.
 */
const titleFromSlug = (slug: string): string =>
  slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

async function loadLessonsBySectionId(db: DrizzleDB) {
  const allLessons = await db
    .select({
      sectionId: lessons.sectionId,
      fsStatus: lessons.fsStatus,
    })
    .from(lessons)
    .where(eq(lessons.archived, false));

  const map = new Map<string, Array<{ fsStatus: string }>>();
  for (const l of allLessons) {
    const arr = map.get(l.sectionId) ?? [];
    arr.push({ fsStatus: l.fsStatus });
    map.set(l.sectionId, arr);
  }
  return map;
}

export async function backfillGhostSectionTitles(db: DrizzleDB) {
  const allSections = await db
    .select({ id: sections.id, path: sections.path })
    .from(sections);

  const lessonsBySectionId = await loadLessonsBySectionId(db);

  for (const section of allSections) {
    const sectionLessons = lessonsBySectionId.get(section.id) ?? [];
    if (sectionHasRealLessons(sectionLessons)) continue;

    await db
      .update(sections)
      .set({ title: section.path })
      .where(eq(sections.id, section.id));
  }
}

export async function backfillRealSectionTitles(db: DrizzleDB) {
  const allSections = await db
    .select({ id: sections.id, path: sections.path })
    .from(sections);

  const lessonsBySectionId = await loadLessonsBySectionId(db);

  for (const section of allSections) {
    const sectionLessons = lessonsBySectionId.get(section.id) ?? [];
    if (!sectionHasRealLessons(sectionLessons)) continue;

    const slug = sectionSlugFromPath(section.path);
    const title = titleFromSlug(slug);

    await db.update(sections).set({ title }).where(eq(sections.id, section.id));
  }
}

export async function assertNoBlankSectionTitles(db: DrizzleDB) {
  const allSections = await db
    .select({ id: sections.id, path: sections.path, title: sections.title })
    .from(sections);

  const lessonsBySectionId = await loadLessonsBySectionId(db);

  const blanks: string[] = [];
  for (const section of allSections) {
    if (section.title !== "") continue;

    const sectionLessons = lessonsBySectionId.get(section.id) ?? [];
    const isReal = sectionHasRealLessons(sectionLessons);

    const derivedTitle = isReal
      ? titleFromSlug(sectionSlugFromPath(section.path))
      : section.path;

    if (derivedTitle !== "") {
      blanks.push(section.id);
    }
  }

  if (blanks.length > 0) {
    throw new Error(
      `Post-condition failed: ${blanks.length} section(s) have blank title but a non-empty derived title: ${blanks.join(", ")}`
    );
  }
}
