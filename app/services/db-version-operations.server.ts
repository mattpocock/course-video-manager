import {
  DrizzleService,
  type DrizzleDB,
} from "@/services/drizzle-service.server";
import {
  clips,
  chapters,
  lessons,
  courses,
  courseVersions,
  sections,
  thumbnails,
  videos,
} from "@/db/schema";
import {
  CannotUpdatePublishedVersionError,
  NotFoundError,
  NotLatestVersionError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { asc, and, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { toTranscriptItems } from "@/lib/transcript-builder";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createVersionOperations = (db: DrizzleDB) => {
  const getCourseVersions = Effect.fn("getCourseVersions")(function* (
    repoId: string
  ) {
    const versions = yield* makeDbCall(() =>
      db.query.courseVersions.findMany({
        where: eq(courseVersions.repoId, repoId),
        orderBy: desc(courseVersions.createdAt),
      })
    );
    return versions;
  });

  const getLatestCourseVersion = Effect.fn("getLatestCourseVersion")(function* (
    repoId: string
  ) {
    const version = yield* makeDbCall(() =>
      db.query.courseVersions.findFirst({
        where: eq(courseVersions.repoId, repoId),
        orderBy: desc(courseVersions.createdAt),
      })
    );
    return version;
  });

  const getCourseVersionById = Effect.fn("getCourseVersionById")(function* (
    versionId: string
  ) {
    const version = yield* makeDbCall(() =>
      db.query.courseVersions.findFirst({
        where: eq(courseVersions.id, versionId),
      })
    );

    if (!version) {
      return yield* new NotFoundError({
        type: "getCourseVersionById",
        params: { versionId },
      });
    }

    return version;
  });

  const getCourseWithSectionsByVersion = Effect.fn(
    "getCourseWithSectionsByVersion"
  )(function* (opts: { repoId: string; versionId: string }) {
    const { repoId, versionId } = opts;
    const course = yield* makeDbCall(() =>
      db.query.courses.findFirst({
        where: eq(courses.id, repoId),
      })
    );

    if (!course) {
      return yield* new NotFoundError({
        type: "getCourseWithSectionsByVersion",
        params: { repoId, versionId },
      });
    }

    const versionSections = yield* makeDbCall(() =>
      db.query.sections.findMany({
        where: and(
          eq(sections.repoVersionId, versionId),
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
                with: {
                  clips: {
                    orderBy: asc(clips.order),
                    where: eq(clips.archived, false),
                  },
                  chapters: {
                    orderBy: asc(chapters.order),
                    where: eq(chapters.archived, false),
                  },
                },
              },
            },
          },
        },
      })
    );

    return {
      ...course,
      sections: versionSections,
    };
  });

  const getCourseWithSectionsByVersionSlim = Effect.fn(
    "getCourseWithSectionsByVersionSlim"
  )(function* (opts: { repoId: string; versionId: string }) {
    const { repoId, versionId } = opts;
    const course = yield* makeDbCall(() =>
      db.query.courses.findFirst({
        where: eq(courses.id, repoId),
      })
    );

    if (!course) {
      return yield* new NotFoundError({
        type: "getCourseWithSectionsByVersionSlim",
        params: { repoId, versionId },
      });
    }

    const versionSections = yield* makeDbCall(() =>
      db.query.sections.findMany({
        where: and(
          eq(sections.repoVersionId, versionId),
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
                with: {
                  clips: {
                    columns: {
                      id: true,
                      videoFilename: true,
                    },
                    orderBy: asc(clips.order),
                    where: eq(clips.archived, false),
                  },
                },
              },
            },
          },
        },
      })
    );

    return {
      ...course,
      sections: versionSections,
    };
  });

  const getVersionWithSections = Effect.fn("getVersionWithSections")(function* (
    versionId: string
  ) {
    const version = yield* makeDbCall(() =>
      db.query.courseVersions.findFirst({
        where: eq(courseVersions.id, versionId),
        with: {
          repo: true,
          sections: {
            where: isNull(sections.archivedAt),
            orderBy: asc(sections.order),
            with: {
              lessons: {
                orderBy: asc(lessons.order),
                where: eq(lessons.archived, false),
                with: {
                  videos: {
                    orderBy: asc(videos.path),
                    with: {
                      clips: {
                        orderBy: asc(clips.order),
                        where: eq(clips.archived, false),
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

    if (!version) {
      return yield* new NotFoundError({
        type: "getVersionWithSections",
        params: { versionId },
      });
    }

    return version;
  });

  const createCourseVersion = Effect.fn("createCourseVersion")(
    function* (input: { repoId: string; name: string }) {
      const [version] = yield* makeDbCall(() =>
        db.insert(courseVersions).values(input).returning()
      );

      if (!version) {
        return yield* new UnknownDBServiceError({
          cause: "No version was returned from the database",
        });
      }

      return version;
    }
  );

  const updateCourseVersion = Effect.fn("updateCourseVersion")(
    function* (opts: { versionId: string; name: string; description: string }) {
      const { versionId, name, description } = opts;

      // Find the version to get its courseId
      const version = yield* makeDbCall(() =>
        db.query.courseVersions.findFirst({
          where: eq(courseVersions.id, versionId),
        })
      );

      if (!version) {
        return yield* new NotFoundError({
          type: "updateCourseVersion",
          params: { versionId },
        });
      }

      // Check if this is the latest (draft) version
      const latestVersion = yield* makeDbCall(() =>
        db.query.courseVersions.findFirst({
          where: eq(courseVersions.repoId, version.repoId),
          orderBy: desc(courseVersions.createdAt),
        })
      );

      if (!latestVersion || latestVersion.id !== versionId) {
        return yield* new CannotUpdatePublishedVersionError({ versionId });
      }

      const [updated] = yield* makeDbCall(() =>
        db
          .update(courseVersions)
          .set({ name, description })
          .where(eq(courseVersions.id, versionId))
          .returning()
      );

      if (!updated) {
        return yield* new NotFoundError({
          type: "updateCourseVersion",
          params: { versionId },
        });
      }

      return updated;
    }
  );

  const copyVersionStructure = Effect.fn("copyVersionStructure")(
    function* (input: {
      sourceVersionId: string;
      repoId: string;
      newVersionName?: string;
    }) {
      const latestVersion = yield* makeDbCall(() =>
        db.query.courseVersions.findFirst({
          where: eq(courseVersions.repoId, input.repoId),
          orderBy: desc(courseVersions.createdAt),
        })
      );

      if (!latestVersion || latestVersion.id !== input.sourceVersionId) {
        return yield* new NotLatestVersionError({
          sourceVersionId: input.sourceVersionId,
          latestVersionId: latestVersion?.id ?? "none",
        });
      }

      const newVersion = yield* makeDbCall(() =>
        db
          .insert(courseVersions)
          .values({
            repoId: input.repoId,
            name: input.newVersionName ?? "",
          })
          .returning()
      ).pipe(
        Effect.andThen((arr) => {
          const v = arr[0];
          if (!v) {
            return Effect.fail(
              new UnknownDBServiceError({ cause: "No version returned" })
            );
          }
          return Effect.succeed(v);
        })
      );

      const sourceSections = yield* makeDbCall(() =>
        db.query.sections.findMany({
          where: and(
            eq(sections.repoVersionId, input.sourceVersionId),
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
                    thumbnails: true,
                  },
                },
              },
            },
          },
        })
      );

      const videoIdMappings: Array<{
        sourceVideoId: string;
        newVideoId: string;
      }> = [];

      for (const sourceSection of sourceSections) {
        const [newSection] = yield* makeDbCall(() =>
          db
            .insert(sections)
            .values({
              repoVersionId: newVersion.id,
              previousVersionSectionId: sourceSection.id,
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
                previousVersionLessonId: sourceLesson.id,
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

            videoIdMappings.push({
              sourceVideoId: sourceVideo.id,
              newVideoId: newVideo.id,
            });

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

      return { version: newVersion, videoIdMappings };
    }
  );

  const getVideoIdsForVersion = Effect.fn("getVideoIdsForVersion")(function* (
    versionId: string
  ) {
    const versionSections = yield* makeDbCall(() =>
      db.query.sections.findMany({
        where: and(
          eq(sections.repoVersionId, versionId),
          isNull(sections.archivedAt)
        ),
        with: {
          lessons: {
            where: eq(lessons.archived, false),
            with: {
              videos: {
                columns: {
                  id: true,
                },
              },
            },
          },
        },
      })
    );

    const videoIds: string[] = [];
    for (const section of versionSections) {
      for (const lesson of section.lessons) {
        for (const video of lesson.videos) {
          videoIds.push(video.id);
        }
      }
    }

    return videoIds;
  });

  const getAllVersionsWithStructure = Effect.fn("getAllVersionsWithStructure")(
    function* (repoId: string) {
      const versions = yield* makeDbCall(() =>
        db.query.courseVersions.findMany({
          where: eq(courseVersions.repoId, repoId),
          orderBy: desc(courseVersions.createdAt),
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
                      orderBy: asc(videos.path),
                      with: {
                        clips: {
                          orderBy: asc(clips.order),
                          where: eq(clips.archived, false),
                        },
                        chapters: {
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
        })
      );

      return versions.map((version) => ({
        id: version.id,
        name: version.name,
        description: version.description,
        createdAt: version.createdAt,
        sections: version.sections
          .filter(
            (s) =>
              s.lessons.length === 0 ||
              s.lessons.some((l) => l.fsStatus !== "ghost")
          )
          .map((s) => ({
            id: s.id,
            path: s.path,
            previousVersionSectionId: s.previousVersionSectionId,
            lessons: s.lessons
              .filter((l) => l.fsStatus !== "ghost")
              .map((l) => ({
                id: l.id,
                path: l.path,
                previousVersionLessonId: l.previousVersionLessonId,
                authoringStatus: l.authoringStatus as "todo" | "done" | null,
                videos: l.videos.map((v) => ({
                  id: v.id,
                  path: v.path,
                  transcript: toTranscriptItems(v.clips, v.chapters),
                })),
              })),
          })),
      }));
    }
  );

  return {
    getCourseVersions,
    getLatestCourseVersion,
    getCourseVersionById,
    getCourseWithSectionsByVersion,
    getCourseWithSectionsByVersionSlim,
    getVersionWithSections,
    createCourseVersion,
    updateCourseVersion,
    copyVersionStructure,
    getVideoIdsForVersion,
    getAllVersionsWithStructure,
  };
};

export class VersionOperationsService extends Effect.Service<VersionOperationsService>()(
  "VersionOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createVersionOperations(db);
    }),
  }
) {}
