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
  await testDb.execute(sql`DROP INDEX IF EXISTS "section_version_path_uniq"`);
  await testDb.execute(sql`DROP INDEX IF EXISTS "lesson_section_path_uniq"`);
  await testDb.execute(sql`DROP INDEX IF EXISTS "video_lesson_path_uniq"`);
}

export async function recreateUniqueIndexes(testDb: TestDb) {
  await testDb.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "section_version_path_uniq" ON "course-video-manager_section" ("course_version_id", "path") WHERE "archived_at" IS NULL`
  );
  await testDb.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "lesson_section_path_uniq" ON "course-video-manager_lesson" ("section_id", "path") WHERE NOT "archived"`
  );
  await testDb.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS "video_lesson_path_uniq" ON "course-video-manager_video" ("lesson_id", "path") WHERE NOT "archived"`
  );
}

export async function createCourseAndVersion(testDb: TestDb) {
  const [course] = await testDb
    .insert(courses)
    .values({ name: "Test Course", slug: "test-course", filePath: "/test" })
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
  path: string,
  order: number,
  opts?: {
    id?: string;
    title?: string;
    createdAt?: Date;
    archivedAt?: Date | null;
  }
) {
  const [section] = await testDb
    .insert(sections)
    .values({
      ...(opts?.id ? { id: opts.id } : {}),
      repoVersionId: versionId,
      path,
      order,
      ...(opts?.title !== undefined ? { title: opts.title } : {}),
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
  path: string,
  order: number,
  opts?: {
    id?: string;
    createdAt?: Date;
    archived?: boolean;
    fsStatus?: string;
    title?: string;
  }
) {
  const fsStatus = opts?.fsStatus ?? "ghost";
  const [lesson] = await testDb
    .insert(lessons)
    .values({
      ...(opts?.id ? { id: opts.id } : {}),
      sectionId,
      path,
      order,
      ...(opts?.title !== undefined ? { title: opts.title } : {}),
      archived: opts?.archived ?? false,
      fsStatus,
      ...(fsStatus === "real" ? { authoringStatus: "todo" } : {}),
      ...(opts?.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  return lesson!;
}

export async function createVideo(
  testDb: TestDb,
  lessonId: string,
  path: string,
  opts?: { id?: string; createdAt?: Date; archived?: boolean }
) {
  const [video] = await testDb
    .insert(videos)
    .values({
      ...(opts?.id ? { id: opts.id } : {}),
      lessonId,
      path,
      originalFootagePath: "",
      archived: opts?.archived ?? false,
      ...(opts?.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  return video!;
}
