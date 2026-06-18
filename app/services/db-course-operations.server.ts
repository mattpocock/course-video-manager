import {
  DrizzleService,
  type DrizzleDB,
} from "@/services/drizzle-service.server";
import {
  clips,
  chapters,
  courses,
  courseVersions,
  sections,
  lessons,
  segments,
  videos,
} from "@/db/schema";
import { AmbiguousCourseUpdateError } from "@/services/db-service-errors";
import { asc, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import {
  formatProseTranscript,
  toTranscriptItems,
} from "@/lib/transcript-builder";
import { makeDuplicateCourse } from "@/services/db-course-duplicate.server";
import {
  makeDbCall,
  dbQueryFirst,
  dbMutateReturning,
} from "@/services/db-query-primitives.server";

export const createCourseOperations = (db: DrizzleDB) => {
  const getCourseById = Effect.fn("getCourseById")(function* (id: string) {
    return yield* dbQueryFirst(
      () => db.query.courses.findFirst({ where: eq(courses.id, id) }),
      { type: "getCourse", params: { id } }
    );
  });

  const getCourseByFilePath = Effect.fn("getCourseByFilePath")(function* (
    filePath: string
  ) {
    return yield* dbQueryFirst(
      () =>
        db.query.courses.findFirst({ where: eq(courses.filePath, filePath) }),
      { type: "getCourseByFilePath", params: { filePath } }
    );
  });

  const getCourseWithSectionsById = Effect.fn("getCourseWithSectionsById")(
    function* (id: string) {
      return yield* dbQueryFirst(
        () =>
          db.query.courses.findFirst({
            where: eq(courses.id, id),
            with: {
              versions: {
                orderBy: desc(courseVersions.createdAt),
                with: {
                  sections: {
                    where: isNull(sections.archivedAt),
                    with: {
                      lessons: {
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
                            },
                          },
                        },
                        orderBy: asc(lessons.order),
                      },
                    },
                    orderBy: asc(sections.order),
                  },
                },
              },
            },
          }),
        { type: "getCourseWithSections", params: { id } }
      );
    }
  );

  const getCourseNavigationData = Effect.fn("getCourseNavigationData")(
    function* (id: string) {
      return yield* dbQueryFirst(
        () =>
          db.query.courses.findFirst({
            where: eq(courses.id, id),
            with: {
              versions: {
                orderBy: desc(courseVersions.createdAt),
                limit: 1,
                with: {
                  sections: {
                    where: isNull(sections.archivedAt),
                    orderBy: asc(sections.order),
                    with: {
                      lessons: {
                        orderBy: asc(lessons.order),
                        where: eq(lessons.archived, false),
                        with: {
                          videos: {
                            columns: { id: true, path: true },
                            orderBy: asc(videos.path),
                            where: eq(videos.archived, false),
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
        { type: "getCourseNavigationData", params: { id } }
      );
    }
  );

  const getCourseStructureById = Effect.fn("getCourseStructureById")(function* (
    id: string
  ) {
    return yield* dbQueryFirst(
      () =>
        db.query.courses.findFirst({
          where: eq(courses.id, id),
          columns: { id: true, name: true, memory: true },
          with: {
            versions: {
              orderBy: desc(courseVersions.createdAt),
              columns: { id: true },
              with: {
                sections: {
                  where: isNull(sections.archivedAt),
                  orderBy: asc(sections.order),
                  columns: { id: true, path: true },
                  with: {
                    lessons: {
                      orderBy: asc(lessons.order),
                      where: eq(lessons.archived, false),
                      columns: {
                        id: true,
                        path: true,
                        description: true,
                        fsStatus: true,
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      { type: "getCourseStructureById", params: { id } }
    );
  });

  const getCourseWithSlimClipsById = Effect.fn("getCourseWithSlimClipsById")(
    function* (id: string, versionId?: string) {
      return yield* dbQueryFirst(
        () =>
          db.query.courses.findFirst({
            where: eq(courses.id, id),
            with: {
              versions: {
                orderBy: desc(courseVersions.createdAt),
                ...(versionId
                  ? { where: eq(courseVersions.id, versionId) }
                  : { limit: 1 }),
                with: {
                  sections: {
                    where: isNull(sections.archivedAt),
                    with: {
                      lessons: {
                        where: eq(lessons.archived, false),
                        with: {
                          videos: {
                            orderBy: asc(videos.path),
                            where: eq(videos.archived, false),
                            with: {
                              clips: {
                                columns: {
                                  id: true,
                                  videoFilename: true,
                                  sourceStartTime: true,
                                  sourceEndTime: true,
                                  order: true,
                                  archived: true,
                                },
                                orderBy: asc(clips.order),
                                where: eq(clips.archived, false),
                              },
                              chapters: {
                                columns: {
                                  order: true,
                                  archived: true,
                                },
                                where: eq(chapters.archived, false),
                              },
                              segments: {
                                columns: {
                                  id: true,
                                  kind: true,
                                  title: true,
                                  description: true,
                                  order: true,
                                  videoId: true,
                                },
                                orderBy: asc(segments.order),
                              },
                            },
                          },
                        },
                        orderBy: asc(lessons.order),
                      },
                    },
                    orderBy: asc(sections.order),
                  },
                },
              },
            },
          }),
        { type: "getCourseWithSlimClips", params: { id } }
      );
    }
  );

  const getVideoTranscripts = Effect.fn("getVideoTranscripts")(function* (
    courseId: string
  ) {
    const course = yield* makeDbCall(() =>
      db.query.courses.findFirst({
        where: eq(courses.id, courseId),
        columns: { id: true },
        with: {
          versions: {
            columns: { id: true },
            orderBy: desc(courseVersions.createdAt),
            limit: 1,
            with: {
              sections: {
                where: isNull(sections.archivedAt),
                columns: { id: true },
                with: {
                  lessons: {
                    columns: { id: true },
                    where: eq(lessons.archived, false),
                    with: {
                      videos: {
                        columns: { id: true },
                        where: eq(videos.archived, false),
                        with: {
                          clips: {
                            columns: { text: true, order: true },
                            orderBy: asc(clips.order),
                            where: eq(clips.archived, false),
                          },
                          chapters: {
                            columns: { name: true, order: true },
                            orderBy: asc(chapters.order),
                            where: eq(chapters.archived, false),
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

    const transcripts: Record<string, string> = {};
    const version = course?.versions[0];
    if (version) {
      for (const section of version.sections) {
        for (const lesson of section.lessons) {
          for (const video of lesson.videos) {
            const items = toTranscriptItems(video.clips, video.chapters);
            transcripts[video.id] = formatProseTranscript(items);
          }
        }
      }
    }
    return transcripts;
  });

  const getCourseWithSectionsByFilePath = Effect.fn(
    "getCourseWithSectionsByFilePath"
  )(function* (filePath: string) {
    const course = yield* getCourseByFilePath(filePath);
    return yield* getCourseWithSectionsById(course.id);
  });

  const getCourses = Effect.fn("getCourses")(function* () {
    const result = yield* makeDbCall(() =>
      db.query.courses.findMany({
        where: eq(courses.archived, false),
      })
    );
    return result;
  });

  const getTopActiveCourses = Effect.fn("getTopActiveCourses")(function* (
    limit: number
  ) {
    const result = yield* makeDbCall(() =>
      db.query.courses.findMany({
        where: eq(courses.archived, false),
        orderBy: desc(courses.createdAt),
        limit,
      })
    );
    return result;
  });

  const getArchivedCourses = Effect.fn("getArchivedCourses")(function* () {
    const result = yield* makeDbCall(() =>
      db.query.courses.findMany({
        where: eq(courses.archived, true),
      })
    );
    return result;
  });

  const createCourse = Effect.fn("createCourse")(function* (input: {
    filePath: string;
    name: string;
  }) {
    return yield* dbMutateReturning(() =>
      db.insert(courses).values(input).returning()
    );
  });

  const createGhostCourse = Effect.fn("createGhostCourse")(function* (input: {
    name: string;
  }) {
    return yield* dbMutateReturning(() =>
      db
        .insert(courses)
        .values({ name: input.name, filePath: null })
        .returning()
    );
  });

  const updateCourseName = Effect.fn("updateCourseName")(function* (opts: {
    repoId: string;
    name: string;
  }) {
    const { repoId, name } = opts;
    return yield* dbMutateReturning(
      () =>
        db
          .update(courses)
          .set({ name })
          .where(eq(courses.id, repoId))
          .returning(),
      { type: "updateCourseName", params: { repoId } }
    );
  });

  const updateCourseMemory = Effect.fn("updateCourseMemory")(function* (opts: {
    repoId: string;
    memory: string;
  }) {
    const { repoId, memory } = opts;
    return yield* dbMutateReturning(
      () =>
        db
          .update(courses)
          .set({ memory })
          .where(eq(courses.id, repoId))
          .returning(),
      { type: "updateCourseMemory", params: { repoId } }
    );
  });

  const updateCourseArchiveStatus = Effect.fn("updateCourseArchiveStatus")(
    function* (opts: { repoId: string; archived: boolean }) {
      const { repoId, archived } = opts;
      return yield* dbMutateReturning(
        () =>
          db
            .update(courses)
            .set({ archived })
            .where(eq(courses.id, repoId))
            .returning(),
        { type: "updateCourseArchiveStatus", params: { repoId } }
      );
    }
  );

  const updateCourseFilePath = Effect.fn("updateCourseFilePath")(
    function* (opts: { repoId: string; filePath: string | null }) {
      const { repoId, filePath } = opts;

      const currentCourse = yield* dbQueryFirst(
        () => db.query.courses.findFirst({ where: eq(courses.id, repoId) }),
        { type: "updateCourseFilePath", params: { repoId } }
      );

      if (currentCourse.filePath) {
        const coursesWithSamePath = yield* makeDbCall(() =>
          db.query.courses.findMany({
            where: eq(courses.filePath, currentCourse.filePath!),
          })
        );

        if (coursesWithSamePath.length > 1) {
          return yield* new AmbiguousCourseUpdateError({
            filePath: currentCourse.filePath,
            repoCount: coursesWithSamePath.length,
          });
        }
      }

      return yield* dbMutateReturning(
        () =>
          db
            .update(courses)
            .set({ filePath })
            .where(eq(courses.id, repoId))
            .returning(),
        { type: "updateCourseFilePath", params: { repoId } }
      );
    }
  );

  const deleteCourse = Effect.fn("deleteCourse")(function* (repoId: string) {
    yield* makeDbCall(() => db.delete(courses).where(eq(courses.id, repoId)));
  });

  const duplicateCourse = makeDuplicateCourse(db);

  return {
    getCourseById,
    getCourseByFilePath,
    getCourseWithSectionsById,
    getCourseStructureById,
    getCourseNavigationData,
    getCourseWithSlimClipsById,
    getVideoTranscripts,
    getCourseWithSectionsByFilePath,
    getCourses,
    getTopActiveCourses,
    getArchivedCourses,
    createCourse,
    createGhostCourse,
    updateCourseName,
    updateCourseMemory,
    updateCourseArchiveStatus,
    updateCourseFilePath,
    deleteCourse,
    duplicateCourse,
  };
};

export class CourseOperationsService extends Effect.Service<CourseOperationsService>()(
  "CourseOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createCourseOperations(db);
    }),
  }
) {}
