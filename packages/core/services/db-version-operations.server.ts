import { DrizzleService, type Database } from "./drizzle-service.server.js";
import {
  clips,
  chapters,
  lessons,
  courses,
  courseVersions,
  sections,
  videos,
} from "../db/schema.js";
import {
  CannotUpdatePublishedVersionError,
  NotFoundError,
  UnknownDBServiceError,
} from "./db-service-errors.js";
import { asc, and, desc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { toTranscriptItems } from "../lib/transcript-builder.js";
import { projectVersionPaths, attachDerivedPaths } from "./path-projection.js";
import { overlayExportRelation } from "./db-overlay-operations.server.js";
import { createVersionLifecycleOps } from "./db-version-lifecycle.server.js";
import { createVersionPathOps } from "./db-version-paths.server.js";
import { createVersionCopyOps } from "./db-version-copy.server.js";

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
                    with: { overlays: overlayExportRelation },
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
                        with: { overlays: overlayExportRelation },
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
    // copyVersionStructure / freezeAndCloneVersion — the copy-forward seam
    // (split for the file token budget).
    ...createVersionCopyOps(db),
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
