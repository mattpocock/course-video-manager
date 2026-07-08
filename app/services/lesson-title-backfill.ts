import { lessons } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "@/services/drizzle-service.server";

export async function assertNoBlankLessonTitles(db: DrizzleDB) {
  const allLessons = await db
    .select({
      id: lessons.id,
      title: lessons.title,
    })
    .from(lessons)
    .where(eq(lessons.archived, false));

  const blanks: string[] = [];
  for (const lesson of allLessons) {
    if (lesson.title !== "") continue;
    blanks.push(lesson.id);
  }

  if (blanks.length > 0) {
    throw new Error(
      `Post-condition failed: ${blanks.length} lesson(s) have blank title: ${blanks.join(", ")}`
    );
  }
}
