import {
  clips,
  chapters,
  courses,
  courseVersions,
  sections,
  lessons,
  beats,
  videos,
} from "@/db/schema";
import {
  DrizzleService,
  type DrizzleDB,
} from "@/services/drizzle-service.server";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import type { ArchivedEntity, EntityType } from "./derive-diff-types";
import {
  generateCourseLeaf,
  generateSectionLeaf,
  generateLessonLeaf,
  generateVideoLeaf,
  generateSortedBeats,
  generateSortedTimelineItems,
} from "./vfs-leaves";
import { buildVfsTree, type CourseEntry } from "./vfs-tree";
import { sectionHasRealLessons } from "@/services/section-path-service";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

const loadCourseForVfs = (
  db: DrizzleDB,
  courseId: string,
  versionId?: string
) =>
  Effect.gen(function* () {
    const course = yield* makeDbCall(() =>
      db.query.courses.findFirst({
        where: eq(courses.id, courseId),
        columns: {
          id: true,
          name: true,
          slug: true,
          memory: true,
          archived: true,
          filePath: true,
        },
        with: {
          versions: {
            orderBy: desc(courseVersions.createdAt),
            ...(versionId
              ? { where: eq(courseVersions.id, versionId) }
              : { limit: 1 }),
            columns: { id: true, name: true, description: true },
            with: {
              sections: {
                where: isNull(sections.archivedAt),
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
                          clips: {
                            orderBy: asc(clips.order),
                          },
                          chapters: {
                            orderBy: asc(chapters.order),
                          },
                          beats: {
                            where: eq(beats.archived, false),
                            orderBy: asc(beats.order),
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
      })
    );

    if (!course) {
      return yield* Effect.fail(
        new NotFoundError({
          type: "loadCourseForVfs",
          params: { id: courseId },
        })
      );
    }

    return course;
  });

const courseToEntry = (course: {
  id: string;
  name: string;
  slug: string | null;
  memory: string;
  versions: Array<{
    id: string;
    name: string;
    description: string;
    sections: Array<{
      id: string;
      path: string;
      description: string;
      order: number;
      lessons: Array<{
        id: string;
        path: string;
        title: string;
        description: string;
        icon: string | null;
        priority: number;
        dependencies: string[] | null;
        authoringStatus: string | null;
        fsStatus: string;
        order: number;
        videos: Array<{
          id: string;
          path: string;
          originalFootagePath: string;
          clips: Array<{
            id: string;
            order: string;
            text: string;
            sourceStartTime: number;
            sourceEndTime: number;
            videoFilename: string;
            pauseType: string;
            scene: string | null;
            profile: string | null;
            archived: boolean;
          }>;
          chapters: Array<{
            id: string;
            order: string;
            name: string;
            archived: boolean;
          }>;
          beats: Array<{
            id: string;
            kind: string;
            title: string;
            description: string;
            order: string;
          }>;
        }>;
      }>;
    }>;
  }>;
}): CourseEntry | null => {
  const version = course.versions[0];
  if (!version) return null;

  return {
    slug: course.slug ?? course.id,
    courseLeaf: generateCourseLeaf(
      { id: course.id, name: course.name, memory: course.memory },
      {
        id: version.id,
        name: version.name,
        description: version.description ?? "",
      }
    ),
    sections: version.sections.map((section) => ({
      path: section.path,
      sectionLeaf: generateSectionLeaf({
        id: section.id,
        path: section.path,
        description: section.description,
        lessons: section.lessons,
      }),
      ghost: !sectionHasRealLessons(section.lessons),
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
          beats: generateSortedBeats(video.beats),
          timelineItems: generateSortedTimelineItems(
            video.clips,
            video.chapters
          ),
        })),
      })),
    })),
  };
};

export const buildVfsForCourse = (courseId: string, versionId?: string) =>
  Effect.gen(function* () {
    const db = (yield* DrizzleService) as unknown as DrizzleDB;
    const course = yield* loadCourseForVfs(db, courseId, versionId);
    const entry = courseToEntry(course);

    if (!entry) {
      return yield* Effect.fail(
        new NotFoundError({
          type: "buildVfsForCourse",
          params: { id: courseId, detail: "no version found" },
        })
      );
    }

    const anchor = `/courses/${entry.slug}`;
    const root = buildVfsTree([entry]);
    const version = course.versions[0]!;

    return {
      root,
      anchor,
      courseSlug: entry.slug,
      repoVersionId: version.id,
      filePath: course.filePath ?? null,
    };
  });

export const loadArchivedEntities = (
  db: DrizzleDB,
  repoVersionId: string
): Effect.Effect<Map<string, ArchivedEntity>, UnknownDBServiceError> =>
  Effect.gen(function* () {
    const map = new Map<string, ArchivedEntity>();

    const archivedLessons = yield* makeDbCall(() =>
      db
        .select({
          id: lessons.id,
          sectionPath: sections.path,
        })
        .from(lessons)
        .innerJoin(sections, eq(lessons.sectionId, sections.id))
        .where(
          and(
            eq(lessons.archived, true),
            eq(sections.repoVersionId, repoVersionId)
          )
        )
    );

    for (const row of archivedLessons) {
      map.set(row.id, {
        entityType: "lesson" as EntityType,
        parentLabel: row.sectionPath,
      });
    }

    const archivedVideos = yield* makeDbCall(() =>
      db
        .select({
          id: videos.id,
          lessonTitle: lessons.title,
        })
        .from(videos)
        .innerJoin(lessons, eq(videos.lessonId, lessons.id))
        .innerJoin(sections, eq(lessons.sectionId, sections.id))
        .where(
          and(
            eq(videos.archived, true),
            eq(sections.repoVersionId, repoVersionId)
          )
        )
    );

    for (const row of archivedVideos) {
      map.set(row.id, {
        entityType: "video" as EntityType,
        parentLabel: row.lessonTitle,
      });
    }

    return map;
  });
