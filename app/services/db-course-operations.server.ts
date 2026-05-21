import type { DrizzleDB } from "@/services/drizzle-service.server";
import {
  clips,
  chapters,
  courses,
  courseVersions,
  sections,
  lessons,
  thumbnails,
  videos,
} from "@/db/schema";
import {
  AmbiguousCourseUpdateError,
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import {
  formatProseTranscript,
  toTranscriptItems,
} from "@/lib/transcript-builder";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createCourseOperations = (db: DrizzleDB) => {
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
    const result = yield* makeDbCall(() =>
      db.insert(courses).values(input).returning()
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
    const result = yield* makeDbCall(() =>
      db
        .insert(courses)
        .values({ name: input.name, filePath: null })
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
    const [updated] = yield* makeDbCall(() =>
      db.update(courses).set({ name }).where(eq(courses.id, repoId)).returning()
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

  const duplicateCourse = Effect.fn("duplicateCourse")(function* (input: {
    sourceCourseId: string;
    name: string;
    filePath: string;
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
          filePath: input.filePath,
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
