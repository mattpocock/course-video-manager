import type { DrizzleDB } from "@/services/drizzle-service.server";
import {
  clips,
  chapters,
  courses,
  courseVersions,
  sections,
  lessons,
  segments,
  thumbnails,
  videos,
} from "@/db/schema";
import { NotFoundError } from "@/services/db-service-errors";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import {
  makeDbCall,
  dbQueryFirst,
  dbMutateReturning,
} from "@/services/db-query-primitives.server";

/**
 * Deep-copies a course's latest draft version into a brand-new course: a single
 * fresh draft version, then every non-archived section → lesson → video and each
 * video's clips, chapters, segments, and thumbnails. Split out of
 * `db-course-operations.server.ts` to keep that module under the file-token cap.
 */
export const makeDuplicateCourse = (db: DrizzleDB) =>
  Effect.fn("duplicateCourse")(function* (input: {
    sourceCourseId: string;
    name: string;
    filePath: string;
  }) {
    // Fetch source course
    const sourceCourse = yield* dbQueryFirst(
      () =>
        db.query.courses.findFirst({
          where: eq(courses.id, input.sourceCourseId),
        }),
      {
        type: "duplicateCourse",
        params: { sourceCourseId: input.sourceCourseId },
      }
    );

    // Get latest draft version
    const latestVersion = yield* makeDbCall(() =>
      db.query.courseVersions.findFirst({
        where: eq(courseVersions.repoId, input.sourceCourseId),
        orderBy: desc(courseVersions.createdAt),
      })
    );

    if (!latestVersion) {
      return yield* new NotFoundError({
        type: "duplicateCourse",
        params: { sourceCourseId: input.sourceCourseId },
        message: "Source course has no versions",
      });
    }

    // Create new course with copied memory
    const newCourse = yield* dbMutateReturning(() =>
      db
        .insert(courses)
        .values({
          name: input.name,
          filePath: input.filePath,
          memory: sourceCourse.memory,
        })
        .returning()
    );

    // Create a single fresh draft version
    const newVersion = yield* dbMutateReturning(() =>
      db
        .insert(courseVersions)
        .values({
          repoId: newCourse.id,
          name: "v1.0",
        })
        .returning()
    );

    // Deep-copy from source's latest draft, excluding archived entities
    const sourceSections = yield* makeDbCall(() =>
      db.query.sections.findMany({
        where: and(
          eq(sections.repoVersionId, latestVersion.id),
          isNull(sections.archivedAt)
        ),
        orderBy: asc(sections.order),
        with: {
          lessons: {
            orderBy: asc(lessons.order),
            where: eq(lessons.archived, false),
            with: {
              videos: {
                orderBy: asc(videos.path),
                where: eq(videos.archived, false),
                with: {
                  clips: {
                    orderBy: asc(clips.order),
                    where: eq(clips.archived, false),
                  },
                  chapters: {
                    orderBy: asc(chapters.order),
                    where: eq(chapters.archived, false),
                  },
                  segments: {
                    orderBy: asc(segments.order),
                  },
                  thumbnails: true,
                },
              },
            },
          },
        },
      })
    );

    for (const sourceSection of sourceSections) {
      const [newSection] = yield* makeDbCall(() =>
        db
          .insert(sections)
          .values({
            repoVersionId: newVersion.id,
            previousVersionSectionId: null,
            path: sourceSection.path,
            order: sourceSection.order,
            description: sourceSection.description,
          })
          .returning()
      );

      if (!newSection) continue;

      for (const sourceLesson of sourceSection.lessons) {
        const [newLesson] = yield* makeDbCall(() =>
          db
            .insert(lessons)
            .values({
              sectionId: newSection.id,
              previousVersionLessonId: null,
              path: sourceLesson.path,
              order: sourceLesson.order,
              fsStatus: sourceLesson.fsStatus,
              title: sourceLesson.title,
              description: sourceLesson.description,
              icon: sourceLesson.icon,
              priority: sourceLesson.priority,
              dependencies: sourceLesson.dependencies,
              authoringStatus: sourceLesson.authoringStatus,
            })
            .returning()
        );

        if (!newLesson) continue;

        for (const sourceVideo of sourceLesson.videos) {
          const [newVideo] = yield* makeDbCall(() =>
            db
              .insert(videos)
              .values({
                lessonId: newLesson.id,
                path: sourceVideo.path,
                originalFootagePath: sourceVideo.originalFootagePath,
              })
              .returning()
          );

          if (!newVideo) continue;

          if (sourceVideo.clips.length > 0) {
            yield* makeDbCall(() =>
              db.insert(clips).values(
                sourceVideo.clips.map((clip) => ({
                  videoId: newVideo.id,
                  videoFilename: clip.videoFilename,
                  sourceStartTime: clip.sourceStartTime,
                  sourceEndTime: clip.sourceEndTime,
                  order: clip.order,
                  archived: false,
                  text: clip.text,
                  transcribedAt: clip.transcribedAt,
                  scene: clip.scene,
                  profile: clip.profile,
                  beatType: clip.beatType,
                }))
              )
            );
          }

          if (sourceVideo.chapters.length > 0) {
            yield* makeDbCall(() =>
              db.insert(chapters).values(
                sourceVideo.chapters.map((section) => ({
                  videoId: newVideo.id,
                  name: section.name,
                  order: section.order,
                  archived: false,
                }))
              )
            );
          }

          if (sourceVideo.segments.length > 0) {
            yield* makeDbCall(() =>
              db.insert(segments).values(
                sourceVideo.segments.map((segment) => ({
                  videoId: newVideo.id,
                  kind: segment.kind,
                  title: segment.title,
                  description: segment.description,
                  order: segment.order,
                }))
              )
            );
          }

          if (sourceVideo.thumbnails.length > 0) {
            yield* makeDbCall(() =>
              db.insert(thumbnails).values(
                sourceVideo.thumbnails.map((thumbnail) => ({
                  videoId: newVideo.id,
                  layers: thumbnail.layers,
                  filePath: thumbnail.filePath,
                  selectedForUpload: thumbnail.selectedForUpload,
                }))
              )
            );
          }
        }
      }
    }

    return { course: newCourse, version: newVersion };
  });
