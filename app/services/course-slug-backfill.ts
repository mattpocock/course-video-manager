import { courses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { courseNameToSlug } from "@/services/course-slug";
import type { DrizzleDB } from "@/services/drizzle-service.server";

export async function backfillCourseSlugs(db: DrizzleDB) {
  const allCourses = await db
    .select({
      id: courses.id,
      name: courses.name,
      archived: courses.archived,
      createdAt: courses.createdAt,
    })
    .from(courses)
    .where(eq(courses.archived, false));

  allCourses.sort((a, b) => {
    const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const usedSlugs = new Set<string>();

  for (const course of allCourses) {
    let slug = courseNameToSlug(course.name);
    if (!slug) slug = "untitled";

    if (usedSlugs.has(slug)) {
      let suffix = 2;
      while (usedSlugs.has(`${slug}-${suffix}`)) {
        suffix++;
      }
      const newName = `${course.name}-${suffix}`;
      slug = `${slug}-${suffix}`;
      await db
        .update(courses)
        .set({ name: newName, slug })
        .where(eq(courses.id, course.id));
    } else {
      await db.update(courses).set({ slug }).where(eq(courses.id, course.id));
    }

    usedSlugs.add(slug);
  }

  const archivedCourses = await db
    .select({ id: courses.id, name: courses.name })
    .from(courses)
    .where(eq(courses.archived, true));

  for (const course of archivedCourses) {
    const slug = courseNameToSlug(course.name) || "untitled";
    await db.update(courses).set({ slug }).where(eq(courses.id, course.id));
  }
}
