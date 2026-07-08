import {
  courses,
  courseVersions,
  sections,
  lessons,
  videos,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import type { TestDb } from "@/test-utils/pglite";

export async function dropUniqueIndexes(testDb: TestDb) {
  await testDb.execute(sql`DROP INDEX IF EXISTS "section_version_order_uniq"`);
  await testDb.execute(sql`DROP INDEX IF EXISTS "lesson_section_order_uniq"`);
  await testDb.execute(sql`DROP INDEX IF EXISTS "video_lesson_title_uniq"`);
}

export async function recreateUniqueIndexes(testDb: TestDb) {
  await testDb.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "section_version_order_uniq" ON "course-video-manager_section" ("course_version_id", "order") WHERE "archived_at" IS NULL`
  );
  await testDb.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "lesson_section_order_uniq" ON "course-video-manager_lesson" ("section_id", "order") WHERE NOT "archived"`
  );
  await testDb.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "video_lesson_title_uniq" ON "course-video-manager_video" ("lesson_id", "title") WHERE NOT "archived"`
  );
}

export async function createCourseAndVersion(testDb: TestDb) {
  const [course] = await testDb
    .insert(courses)
    .values({ name: "Test Course", slug: "test-course" })
    .returning();
  const [version] = await testDb
    .insert(courseVersions)
    .values({ repoId: course!.id, name: "" })
    .returning();
  return { courseId: course!.id, versionId: version!.id };
}

export async function createSection(
  testDb: TestDb,
  versionId: string,
  title: string,
  order: number,
  opts?: {
    id?: string;
    createdAt?: Date;
    archivedAt?: Date | null;
  }
) {
  const [section] = await testDb
    .insert(sections)
    .values({
      ...(opts?.id ? { id: opts.id } : {}),
      repoVersionId: versionId,
      title,
      order,
      ...(opts?.createdAt ? { createdAt: opts.createdAt } : {}),
      ...(opts?.archivedAt !== undefined
        ? { archivedAt: opts.archivedAt }
        : {}),
    })
    .returning();
  return section!;
}

export async function createLesson(
  testDb: TestDb,
  sectionId: string,
  title: string,
  order: number,
  opts?: {
    id?: string;
    createdAt?: Date;
    archived?: boolean;
    title?: string;
  }
) {
  const [lesson] = await testDb
    .insert(lessons)
    .values({
      ...(opts?.id ? { id: opts.id } : {}),
      sectionId,
      title: opts?.title ?? title,
      order,
      archived: opts?.archived ?? false,
      authoringStatus: "todo",
      ...(opts?.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  return lesson!;
}

export async function createVideo(
  testDb: TestDb,
  lessonId: string,
  title: string,
  opts?: { id?: string; createdAt?: Date; archived?: boolean }
) {
  const [video] = await testDb
    .insert(videos)
    .values({
      ...(opts?.id ? { id: opts.id } : {}),
      lessonId,
      title,
      originalFootagePath: "",
      archived: opts?.archived ?? false,
      ...(opts?.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  return video!;
}
