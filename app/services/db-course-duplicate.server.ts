import type { Database } from "@/services/drizzle-service.server";
import {
  clips,
  chapters,
  courses,
  courseVersions,
  sections,
  lessons,
  beats,
  thumbnails,
  videos,
} from "@/db/schema";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/**
 * Deep-copies a course's latest draft version into a brand-new course: a single
 * fresh draft version, then every non-archived section → lesson → video and each
 * video's clips, chapters, beats, and thumbnails. Split out of
 * `db-course-operations.server.ts` to keep that module under the file-token cap.
 */
export const makeDuplicateCourse = (db: Database) =>
  Effect.fn("duplicateCourse")(function* (input: {
    sourceCourseId: string;
    name: string;
  }) {
    // Fetch source course
    const sourceCourse = yield* makeDbCall(() =>
      db.query.courses.findFirst({
        where: eq(courses.id, input.sourceCourseId),
      })
    );

    if (!sourceCourse) {
      return yield* new NotFoundError({
        type: "duplicateCourse",
        params: { sourceCourseId: input.sourceCourseId },
      });
    }

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
    const [newCourse] = yield* makeDbCall(() =>
      db
        .insert(courses)
        .values({
          name: input.name,
          memory: sourceCourse.memory,
        })
        .returning()
    );

    if (!newCourse) {
      return yield* new UnknownDBServiceError({
        cause: "No course returned from insert",
      });
    }

    // Create a single fresh draft version
    const [newVersion] = yield* makeDbCall(() =>
      db
        .insert(courseVersions)
        .values({
          repoId: newCourse.id,
          name: "v1.0",
        })
        .returning()
    );

    if (!newVersion) {
      return yield* new UnknownDBServiceError({
        cause: "No version returned from insert",
      });
    }

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
                orderBy: asc(videos.title),
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
                  beats: {
                    orderBy: asc(beats.order),
                    where: eq(beats.archived, false),
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
            title: sourceSection.title,
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
              order: sourceLesson.order,
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
                title: sourceVideo.title,
                originalFootagePath: sourceVideo.originalFootagePath,
                body: sourceVideo.body,
                description: sourceVideo.description,
                script: sourceVideo.script,
                format: sourceVideo.format,
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
                  pauseType: clip.pauseType,
                  diagramSnapshotId: clip.diagramSnapshotId,
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

          if (sourceVideo.beats.length > 0) {
            yield* makeDbCall(() =>
              db.insert(beats).values(
                sourceVideo.beats.map((beat) => ({
                  videoId: newVideo.id,
                  kind: beat.kind,
                  title: beat.title,
                  description: beat.description,
                  order: beat.order,
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
