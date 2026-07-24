import {
  DrizzleService,
  type Database,
} from "@/services/drizzle-service.server";
import {
  clips,
  chapters,
  lessons,
  courses,
  courseVersions,
  sections,
  beats,
  thumbnails,
  videos,
} from "@/db/schema";
import {
  CannotUpdatePublishedVersionError,
  NotFoundError,
  NotLatestVersionError,
  UnknownDBServiceError,
  VersionNotDraftError,
} from "@/services/db-service-errors";
import { asc, and, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { toTranscriptItems } from "@/lib/transcript-builder";
import {
  projectVersionPaths,
  attachDerivedPaths,
} from "@/services/path-projection";
import { requireDraftVersion } from "@/services/draft-guard.server";
import { withDbTransaction } from "@/services/with-db-transaction.server";
import {
  freezeAndCloneVersion as freezeAndCloneVersionTransaction,
  lockCourseForVersionMutation,
  type CopyVersionStructureInput,
} from "@/services/db-version-mutation.server";
import { createVersionLifecycleOps } from "@/services/db-version-lifecycle.server";
import { createVersionPathOps } from "@/services/db-version-paths.server";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createVersionOperations = (db: Database) => {
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
                orderBy: asc(videos.title),
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
      sections: attachDerivedPaths(versionSections),
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
                orderBy: asc(videos.title),
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
      sections: attachDerivedPaths(versionSections),
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
                    orderBy: asc(videos.title),
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

    if (!version) {
      return yield* new NotFoundError({
        type: "getVersionWithSections",
        params: { versionId },
      });
    }

    return {
      ...version,
      sections: attachDerivedPaths(version.sections),
    };
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

      // The commit state is authoritative: only a Draft Version may be
      // renamed. (Previously inferred positionally from "latest by createdAt".)
      if (version.commitState !== "draft") {
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

  const copyVersionStructureInDb = (
    transaction: Database,
    input: CopyVersionStructureInput
  ) =>
    Effect.gen(function* () {
      yield* lockCourseForVersionMutation(transaction, input.repoId);
      const latestVersion = yield* makeDbCall(() =>
        transaction.query.courseVersions.findFirst({
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

      // Only a Draft may be cloned from — the commit state is authoritative.
      if (latestVersion.commitState !== "draft") {
        return yield* new VersionNotDraftError({
          versionId: latestVersion.id,
          commitState: latestVersion.commitState,
        });
      }

      const newVersion = yield* makeDbCall(() =>
        transaction
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
        transaction.query.sections.findMany({
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

      const videoIdMappings: Array<{
        sourceVideoId: string;
        newVideoId: string;
      }> = [];

      for (const sourceSection of sourceSections) {
        const [newSection] = yield* makeDbCall(() =>
          transaction
            .insert(sections)
            .values({
              repoVersionId: newVersion.id,
              previousVersionSectionId: sourceSection.id,
              lineageId: sourceSection.lineageId,
              title: sourceSection.title,
              order: sourceSection.order,
              description: sourceSection.description,
            })
            .returning()
        );

        if (!newSection) continue;

        for (const sourceLesson of sourceSection.lessons) {
          const [newLesson] = yield* makeDbCall(() =>
            transaction
              .insert(lessons)
              .values({
                sectionId: newSection.id,
                previousVersionLessonId: sourceLesson.id,
                lineageId: sourceLesson.lineageId,
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
              transaction
                .insert(videos)
                .values({
                  lessonId: newLesson.id,
                  lineageId: sourceVideo.lineageId,
                  title: sourceVideo.title,
                  originalFootagePath: sourceVideo.originalFootagePath,
                  body: sourceVideo.body,
                  description: sourceVideo.description,
                  script: sourceVideo.script,
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
                transaction.insert(clips).values(
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
                  }))
                )
              );
            }

            if (sourceVideo.chapters.length > 0) {
              yield* makeDbCall(() =>
                transaction.insert(chapters).values(
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
                transaction.insert(beats).values(
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
                transaction.insert(thumbnails).values(
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
    });

  const copyVersionStructure = Effect.fn("copyVersionStructure")(function* (
    input: CopyVersionStructureInput
  ) {
    return yield* withDbTransaction(db, (transaction) =>
      Effect.gen(function* () {
        // #1403: hold the version-row lock guarded writes contend on while
        // cloning, so no write can land on the source mid-freeze.
        yield* requireDraftVersion(transaction, input.sourceVersionId);
        const result = yield* copyVersionStructureInDb(transaction, input);
        // Manual create-version freezes its source without a Dropbox commit:
        // the old Draft becomes an immutable `published` snapshot (that is what
        // the positional model treated every non-latest version as), and the
        // clone becomes the course's single Draft.
        yield* makeDbCall(() =>
          transaction
            .update(courseVersions)
            .set({ commitState: "published" })
            .where(eq(courseVersions.id, input.sourceVersionId))
        );
        return result;
      })
    );
  });

  const freezeAndCloneVersion = Effect.fn("freezeAndCloneVersion")(function* (
    input: CopyVersionStructureInput & {
      sourceName: string;
      sourceDescription: string;
    }
  ) {
    return yield* freezeAndCloneVersionTransaction(
      db,
      input,
      copyVersionStructureInDb
    );
  });

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
                      orderBy: asc(videos.title),
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

      return versions.map((version) => {
        const derivedPaths = projectVersionPaths(version.sections);
        return {
          id: version.id,
          name: version.name,
          description: version.description,
          commitState: version.commitState,
          createdAt: version.createdAt,
          sections: version.sections.map((s) => ({
            id: s.id,
            path: derivedPaths.get(s.id) ?? "",
            previousVersionSectionId: s.previousVersionSectionId,
            lessons: s.lessons.map((l) => ({
              id: l.id,
              path: derivedPaths.get(l.id) ?? "",
              previousVersionLessonId: l.previousVersionLessonId,
              authoringStatus: l.authoringStatus as "todo" | "done" | null,
              videos: l.videos.map((v) => ({
                id: v.id,
                title: v.title,
                transcript: toTranscriptItems(v.clips, v.chapters),
              })),
            })),
          })),
        };
      });
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
    freezeAndCloneVersion,
    // Promote / Discard + commitState readers (issues #1348/#1401).
    ...createVersionLifecycleOps(db),
    getVideoIdsForVersion,
    getAllVersionsWithStructure,
    // resolveLessonDir / resolveSectionDir (split for the file token budget).
    ...createVersionPathOps(db),
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
