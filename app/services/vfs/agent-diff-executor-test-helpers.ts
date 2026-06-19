import { Effect, Layer } from "effect";
import type { TestDb } from "@/test-utils/pglite";
import type { Op } from "./derive-diff-types";
import {
  executeOps,
  type ExecutorContext,
  type ExecutorResult,
  type ExecutorRejection,
} from "./agent-diff-executor";
import { buildVfsTree, type CourseEntry } from "./vfs-tree";
import {
  generateCourseLeaf,
  generateSectionLeaf,
  generateLessonLeaf,
  generateVideoLeaf,
  generateSortedSegments,
  generateSortedTimelineItems,
} from "./vfs-leaves";
import {
  courses,
  courseVersions,
  sections,
  lessons,
  videos,
  clips,
  chapters,
  segments,
} from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { DrizzleService } from "@/services/drizzle-service.server";

export const COURSE_ID = "course-1";
export const VERSION_ID = "version-1";
export const SECTION_ID = "sec-1";
export const LESSON_ID = "les-1";
export const VIDEO_ID = "vid-1";

export async function seedGhostCourse(testDb: TestDb) {
  await testDb
    .insert(courses)
    .values({
      id: COURSE_ID,
      name: "Test Course",
      slug: "test-course",
      filePath: null,
    });
  await testDb
    .insert(courseVersions)
    .values({ id: VERSION_ID, repoId: COURSE_ID, name: "v1" });
  await testDb
    .insert(sections)
    .values({
      id: SECTION_ID,
      repoVersionId: VERSION_ID,
      path: "basics",
      order: 0,
    });
  await testDb
    .insert(lessons)
    .values({
      id: LESSON_ID,
      sectionId: SECTION_ID,
      path: "intro",
      title: "Introduction",
      fsStatus: "ghost",
      order: 0,
    });
}

export async function seedRealCourse(testDb: TestDb) {
  await testDb
    .insert(courses)
    .values({
      id: COURSE_ID,
      name: "Test Course",
      slug: "test-course",
      filePath: "/repo/test-course",
    });
  await testDb
    .insert(courseVersions)
    .values({ id: VERSION_ID, repoId: COURSE_ID, name: "v1" });
  await testDb
    .insert(sections)
    .values({
      id: SECTION_ID,
      repoVersionId: VERSION_ID,
      path: "basics",
      order: 0,
    });
  await testDb
    .insert(lessons)
    .values({
      id: LESSON_ID,
      sectionId: SECTION_ID,
      path: "intro",
      title: "Introduction",
      fsStatus: "ghost",
      order: 0,
    });
}

export async function seedVideoWithClips(testDb: TestDb) {
  await seedGhostCourse(testDb);
  await testDb
    .insert(videos)
    .values({
      id: VIDEO_ID,
      lessonId: LESSON_ID,
      path: "vid-01",
      originalFootagePath: "/footage/01",
    });
  await testDb.insert(clips).values([
    {
      id: "clip-a",
      videoId: VIDEO_ID,
      videoFilename: "01.mp4",
      sourceStartTime: 0,
      sourceEndTime: 10,
      order: "a0",
      text: "Hello",
    },
    {
      id: "clip-b",
      videoId: VIDEO_ID,
      videoFilename: "01.mp4",
      sourceStartTime: 10,
      sourceEndTime: 20,
      order: "a1",
      text: "World",
    },
  ]);
  await testDb
    .insert(chapters)
    .values({
      id: "chap-1",
      videoId: VIDEO_ID,
      name: "Chapter One",
      order: "a0V",
    });
}

export async function seedVideoWithSegments(testDb: TestDb) {
  await seedGhostCourse(testDb);
  await testDb
    .insert(videos)
    .values({
      id: VIDEO_ID,
      lessonId: LESSON_ID,
      path: "vid-01",
      originalFootagePath: "/footage/01",
    });
  await testDb.insert(segments).values([
    {
      id: "seg-1",
      videoId: VIDEO_ID,
      kind: "definition",
      title: "Segment One",
      order: "a0",
    },
    {
      id: "seg-2",
      videoId: VIDEO_ID,
      kind: "demo",
      title: "Segment Two",
      order: "a1",
    },
  ]);
}

export function buildCtxFromDb(
  testDb: TestDb,
  filePath: string | null,
  vfsPath: string,
  root: ReturnType<typeof buildVfsTree>
): ExecutorContext {
  return {
    db: testDb as any,
    courseId: COURSE_ID,
    repoVersionId: VERSION_ID,
    filePath,
    root,
    path: vfsPath,
  };
}

export async function buildVfsFromDb(
  testDb: TestDb
): Promise<ReturnType<typeof buildVfsTree>> {
  const course = await testDb.query.courses.findFirst({
    where: eq(courses.id, COURSE_ID),
    with: {
      versions: {
        limit: 1,
        with: {
          sections: {
            orderBy: asc(sections.order),
            with: {
              lessons: {
                where: eq(lessons.archived, false),
                orderBy: asc(lessons.order),
                with: {
                  videos: {
                    where: eq(videos.archived, false),
                    orderBy: asc(videos.path),
                    with: {
                      clips: { orderBy: asc(clips.order) },
                      chapters: { orderBy: asc(chapters.order) },
                      segments: {
                        where: eq(segments.archived, false),
                        orderBy: asc(segments.order),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!course || !course.versions[0]) throw new Error("No course found");
  const version = course.versions[0];

  const entry: CourseEntry = {
    slug: course.slug ?? course.id,
    courseLeaf: generateCourseLeaf(
      { id: course.id, name: course.name, memory: course.memory },
      { id: version.id, name: version.name, description: version.description }
    ),
    sections: version.sections.map((section) => ({
      path: section.path,
      sectionLeaf: generateSectionLeaf({
        id: section.id,
        path: section.path,
        description: section.description,
        lessons: section.lessons,
      }),
      ghost: !section.lessons.some((l) => l.fsStatus === "real"),
      lessons: section.lessons.map((lesson) => ({
        path: lesson.path,
        lessonLeaf: generateLessonLeaf({
          id: lesson.id,
          path: lesson.path,
          title: lesson.title,
          description: lesson.description,
          icon: lesson.icon,
          priority: lesson.priority,
          dependencies: lesson.dependencies,
          authoringStatus: lesson.authoringStatus,
          fsStatus: lesson.fsStatus,
        }),
        ghost: lesson.fsStatus === "ghost",
        videos: lesson.videos.map((video) => ({
          path: video.path,
          videoLeaf: generateVideoLeaf({
            id: video.id,
            path: video.path,
            originalFootagePath: video.originalFootagePath,
            clips: video.clips,
            chapters: video.chapters,
          }),
          segments: generateSortedSegments(video.segments),
          timelineItems: generateSortedTimelineItems(
            video.clips,
            video.chapters
          ),
        })),
      })),
    })),
  };

  return buildVfsTree([entry]);
}

export function runExecutor(
  testDb: TestDb,
  ops: Op[],
  ctx: ExecutorContext
): Promise<ExecutorResult | ExecutorRejection> {
  return Effect.runPromise(
    executeOps(ops, ctx).pipe(
      Effect.provide(Layer.succeed(DrizzleService, testDb as any))
    )
  );
}
