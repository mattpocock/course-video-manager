import {
  DrizzleService,
  type Database,
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
import {
  AmbiguousCourseUpdateError,
  CourseNameTakenError,
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { Effect } from "effect";
import { courseNameToSlug } from "@/services/course-slug";
import {
  formatProseTranscript,
  toTranscriptItems,
} from "@/lib/transcript-builder";
import { makeDuplicateCourse } from "@/services/db-course-duplicate.server";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createCourseOperations = (db: Database) => {
  const assertSlugAvailable = Effect.fn("assertSlugAvailable")(function* (
    name: string,
    excludeCourseId?: string
  ) {
    const slug = courseNameToSlug(name);
    if (!slug) {
      return yield* new CourseNameTakenError({
        name,
        slug: "",
        message:
          "Course name must produce a valid slug (at least one letter or digit)",
      });
    }

    const conditions = [eq(courses.slug, slug), eq(courses.archived, false)];
    if (excludeCourseId) {
      conditions.push(ne(courses.id, excludeCourseId));
    }

    const existing = yield* makeDbCall(() =>
      db.query.courses.findFirst({
        where: and(...conditions),
        columns: { id: true },
      })
    );

    if (existing) {
      return yield* new CourseNameTakenError({
        name,
        slug,
        message: `Course name "${name}" is already taken`,
      });
    }

    return slug;
  });

  const getCourseById = Effect.fn("getCourseById")(function* (id: string) {
    const course = yield* makeDbCall(() =>
      db.query.courses.findFirst({
        where: eq(courses.id, id),
      })
    );

    if (!course) {
      return yield* new NotFoundError({
        type: "getCourse",
        params: { id },
      });
    }

    return course;
  });

  const getCourseByFilePath = Effect.fn("getCourseByFilePath")(function* (
    filePath: string
  ) {
    const course = yield* makeDbCall(() =>
      db.query.courses.findFirst({
        where: eq(courses.filePath, filePath),
      })
    );

    if (!course) {
      return yield* new NotFoundError({
        type: "getCourseByFilePath",
        params: { filePath },
      });
    }

    return course;
  });

  const getCourseWithSectionsById = Effect.fn("getCourseWithSectionsById")(
    function* (id: string) {
      const course = yield* makeDbCall(() =>
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
        })
      );

      if (!course) {
        return yield* new NotFoundError({
          type: "getCourseWithSections",
          params: { id },
        });
      }

      return course;
    }
  );

  const getCourseNavigationData = Effect.fn("getCourseNavigationData")(
    function* (id: string) {
      const course = yield* makeDbCall(() =>
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
        })
      );

      if (!course) {
        return yield* new NotFoundError({
          type: "getCourseNavigationData",
          params: { id },
        });
      }

      return course;
    }
  );

  const getCourseStructureById = Effect.fn("getCourseStructureById")(function* (
    id: string
  ) {
    const course = yield* makeDbCall(() =>
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
      })
    );

    if (!course) {
      return yield* new NotFoundError({
        type: "getCourseStructureById",
        params: { id },
      });
    }

    return course;
  });

  const getCourseWithSlimClipsById = Effect.fn("getCourseWithSlimClipsById")(
    function* (id: string, versionId?: string) {
      const course = yield* makeDbCall(() =>
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
                              where: eq(segments.archived, false),
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
        })
      );

      if (!course) {
        return yield* new NotFoundError({
          type: "getCourseWithSlimClips",
          params: { id },
        });
      }

      return course;
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
        orderBy: desc(courses.createdAt),
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
        orderBy: desc(courses.createdAt),
      })
    );
    return result;
  });

  const createCourse = Effect.fn("createCourse")(function* (input: {
    filePath: string;
    name: string;
  }) {
    const slug = yield* assertSlugAvailable(input.name);

    const result = yield* makeDbCall(() =>
      db
        .insert(courses)
        .values({ ...input, slug })
        .returning()
    );

    const course = result[0];

    if (!course) {
      return yield* new UnknownDBServiceError({
        cause: "No course was returned from the database",
      });
    }

    return course;
  });

  const createGhostCourse = Effect.fn("createGhostCourse")(function* (input: {
    name: string;
  }) {
    const slug = yield* assertSlugAvailable(input.name);

    const result = yield* makeDbCall(() =>
      db
        .insert(courses)
        .values({ name: input.name, filePath: null, slug })
        .returning()
    );

    const course = result[0];

    if (!course) {
      return yield* new UnknownDBServiceError({
        cause: "No course was returned from the database",
      });
    }

    return course;
  });

  const updateCourseName = Effect.fn("updateCourseName")(function* (opts: {
    repoId: string;
    name: string;
  }) {
    const { repoId, name } = opts;
    const slug = yield* assertSlugAvailable(name, repoId);

    const [updated] = yield* makeDbCall(() =>
      db
        .update(courses)
        .set({ name, slug })
        .where(eq(courses.id, repoId))
        .returning()
    );

    if (!updated) {
      return yield* new NotFoundError({
        type: "updateCourseName",
        params: { repoId },
      });
    }

    return updated;
  });

  const updateCourseMemory = Effect.fn("updateCourseMemory")(function* (opts: {
    repoId: string;
    memory: string;
  }) {
    const { repoId, memory } = opts;
    const [updated] = yield* makeDbCall(() =>
      db
        .update(courses)
        .set({ memory })
        .where(eq(courses.id, repoId))
        .returning()
    );

    if (!updated) {
      return yield* new NotFoundError({
        type: "updateCourseMemory",
        params: { repoId },
      });
    }

    return updated;
  });

  const updateCourseArchiveStatus = Effect.fn("updateCourseArchiveStatus")(
    function* (opts: { repoId: string; archived: boolean }) {
      const { repoId, archived } = opts;
      const [updated] = yield* makeDbCall(() =>
        db
          .update(courses)
          .set({ archived })
          .where(eq(courses.id, repoId))
          .returning()
      );

      if (!updated) {
        return yield* new NotFoundError({
          type: "updateCourseArchiveStatus",
          params: { repoId },
        });
      }

      return updated;
    }
  );

  const updateCourseFilePath = Effect.fn("updateCourseFilePath")(
    function* (opts: { repoId: string; filePath: string | null }) {
      const { repoId, filePath } = opts;

      const currentCourse = yield* makeDbCall(() =>
        db.query.courses.findFirst({
          where: eq(courses.id, repoId),
        })
      );

      if (!currentCourse) {
        return yield* new NotFoundError({
          type: "updateCourseFilePath",
          params: { repoId },
        });
      }

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

      const [updated] = yield* makeDbCall(() =>
        db
          .update(courses)
          .set({ filePath })
          .where(eq(courses.id, repoId))
          .returning()
      );

      if (!updated) {
        return yield* new NotFoundError({
          type: "updateCourseFilePath",
          params: { repoId },
        });
      }

      return updated;
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
