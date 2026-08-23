import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { clips, chapters, videos, clipWebLinks } from "../db/schema.js";
import {
  CannotArchiveLessonVideoError,
  NotFoundError,
  UnknownDBServiceError,
  VideoTitleTakenError,
} from "./db-service-errors.js";
import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { Effect } from "effect";
import { copyVideoImpl } from "./db-video-operations.copy.server.js";
import {
  createVideoWriteOps,
  videoWriteMethods,
} from "./db-video-operations.write.server.js";
import { transactionalizeWrites } from "./with-db-transaction.server.js";
import type { VideoFormat } from "../features/videos/video-format.js";
import {
  requireDraftVersionForLesson,
  requireDraftVersionForVideo,
} from "./draft-guard.server.js";
import { overlayExportRelation } from "./db-overlay-operations.server.js";
import { createVideoNavigationOps } from "./db-video-navigation.server.js";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

type VideoOpsDeps = {
  getCourseNavigationData: (id: string) => Effect.Effect<any, any>;
};

const createVideoOperationsUnwrapped = (db: Database, deps: VideoOpsDeps) => {
  const { getCourseNavigationData } = deps;

  const assertVideoTitleAvailable = Effect.fn("assertVideoTitleAvailable")(
    function* (lessonId: string, title: string, excludeVideoId?: string) {
      const conditions = [
        eq(videos.lessonId, lessonId),
        eq(videos.title, title),
        eq(videos.archived, false),
      ];
      if (excludeVideoId) {
        conditions.push(ne(videos.id, excludeVideoId));
      }

      const existing = yield* makeDbCall(() =>
        db.query.videos.findFirst({
          where: and(...conditions),
          columns: { id: true },
        })
      );

      if (existing) {
        return yield* new VideoTitleTakenError({
          title,
          message: `Video name "${title}" is already taken in this lesson`,
        });
      }
    }
  );

  const getVideoDeepById = Effect.fn("getVideoById")(function* (id: string) {
    const video = yield* makeDbCall(() =>
      db.query.videos.findFirst({
        where: eq(videos.id, id),
        with: {
          lesson: {
            with: {
              section: {
                with: {
                  repoVersion: {
                    with: {
                      repo: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
    );

    if (!video) {
      return yield* new NotFoundError({
        type: "getVideoById",
        params: { id },
      });
    }

    return video;
  });

  const getStandaloneVideos = Effect.fn("getStandaloneVideos")(function* () {
    const standaloneVideos = yield* makeDbCall(() =>
      db.query.videos.findMany({
        where: and(
          isNull(videos.lessonId),
          isNull(videos.pitchId),
          eq(videos.archived, false)
        ),
        orderBy: desc(videos.updatedAt),
        limit: 5,
        with: {
          clips: {
            orderBy: asc(clips.order),
            where: eq(clips.archived, false),
          },
        },
      })
    );

    return standaloneVideos;
  });

  const getStandaloneVideosSidebar = Effect.fn("getStandaloneVideosSidebar")(
    function* () {
      const standaloneVideos = yield* makeDbCall(() =>
        db.query.videos.findMany({
          columns: { id: true, title: true },
          where: and(
            isNull(videos.lessonId),
            isNull(videos.pitchId),
            eq(videos.archived, false)
          ),
          orderBy: desc(videos.updatedAt),
          limit: 5,
        })
      );

      return standaloneVideos;
    }
  );

  const getAllStandaloneVideos = Effect.fn("getAllStandaloneVideos")(
    function* (opts?: { format?: VideoFormat }) {
      const conditions = [
        isNull(videos.lessonId),
        isNull(videos.pitchId),
        eq(videos.archived, false),
      ];
      if (opts?.format) {
        conditions.push(eq(videos.format, opts.format));
      }
      const standaloneVideos = yield* makeDbCall(() =>
        db.query.videos.findMany({
          where: and(...conditions),
          orderBy: desc(videos.updatedAt),
          with: {
            clips: {
              orderBy: asc(clips.order),
              where: eq(clips.archived, false),
              with: { overlays: overlayExportRelation },
            },
          },
        })
      );

      return standaloneVideos;
    }
  );

  const getArchivedStandaloneVideos = Effect.fn("getArchivedStandaloneVideos")(
    function* (opts?: { format?: VideoFormat }) {
      const conditions = [
        isNull(videos.lessonId),
        isNull(videos.pitchId),
        eq(videos.archived, true),
      ];
      if (opts?.format) {
        conditions.push(eq(videos.format, opts.format));
      }
      const archivedVideos = yield* makeDbCall(() =>
        db.query.videos.findMany({
          where: and(...conditions),
          orderBy: desc(videos.createdAt),
          with: {
            clips: {
              orderBy: asc(clips.order),
              where: eq(clips.archived, false),
              with: { overlays: overlayExportRelation },
            },
          },
        })
      );

      return archivedVideos;
    }
  );

  const getVideoWithClipsById = Effect.fn("getVideoWithClipsById")(function* (
    id: string,
    opts?: {
      withArchived?: boolean;
    }
  ) {
    const video = yield* makeDbCall(() =>
      db.query.videos.findFirst({
        where: eq(videos.id, id),
        with: {
          lesson: {
            with: {
              section: {
                with: {
                  repoVersion: {
                    with: {
                      repo: true,
                    },
                  },
                },
              },
              videos: {
                columns: { id: true, title: true },
                where: eq(videos.archived, false),
              },
            },
          },
          clips: {
            orderBy: asc(clips.order),
            ...(opts?.withArchived ? {} : { where: eq(clips.archived, false) }),
            with: {
              overlays: overlayExportRelation,
              diagramSnapshot: {
                with: {
                  diagram: {
                    columns: { name: true },
                  },
                },
              },
              webLinks: {
                orderBy: asc(clipWebLinks.capturedAt),
              },
            },
          },
          chapters: {
            orderBy: asc(chapters.order),
            ...(opts?.withArchived
              ? {}
              : { where: eq(chapters.archived, false) }),
          },
        },
      })
    );

    if (!video) {
      return yield* new NotFoundError({
        type: "getVideoWithClipsById",
        params: { id },
      });
    }

    return video;
  });

  /**
   * The full script text for a set of videos, keyed by video id. Powers the
   * section page's Scripts tab, which re-attaches scripts to the one section it
   * narrows to (the course-view loader slims them away — see `toSlimVideo`).
   * Videos with no row / no id in the set are simply absent from the map.
   */
  const getVideoScriptsByIds = Effect.fn("getVideoScriptsByIds")(function* (
    ids: string[]
  ) {
    if (ids.length === 0) return {} as Record<string, string | null>;
    const rows = yield* makeDbCall(() =>
      db.query.videos.findMany({
        where: inArray(videos.id, ids),
        columns: { id: true, script: true },
      })
    );
    return Object.fromEntries(
      rows.map((row) => [row.id, row.script])
    ) as Record<string, string | null>;
  });

  const getVideoWithLessonById = Effect.fn("getVideoWithLessonById")(function* (
    id: string
  ) {
    const video = yield* makeDbCall(() =>
      db.query.videos.findFirst({
        where: eq(videos.id, id),
        with: {
          lesson: {
            with: {
              section: {
                with: {
                  repoVersion: {
                    with: {
                      repo: true,
                    },
                  },
                },
              },
              videos: {
                where: eq(videos.archived, false),
              },
            },
          },
        },
      })
    );

    if (!video) {
      return yield* new NotFoundError({
        type: "getVideoWithLessonById",
        params: { id },
      });
    }

    return video;
  });

  const createVideo = Effect.fn("createVideo")(function* (
    lessonId: string,
    video: {
      title: string;
      originalFootagePath: string;
    }
  ) {
    yield* requireDraftVersionForLesson(db, lessonId);
    yield* assertVideoTitleAvailable(lessonId, video.title);

    const videoResults = yield* makeDbCall(() =>
      db
        .insert(videos)
        .values({ ...video, lessonId })
        .returning()
    );

    const videoResult = videoResults[0];

    if (!videoResult) {
      return yield* new UnknownDBServiceError({
        cause: "No video was returned from the database",
      });
    }

    return videoResult;
  });

  const createStandaloneVideo = Effect.fn("createStandaloneVideo")(
    function* (video: { title: string; format?: VideoFormat }) {
      const videoResults = yield* makeDbCall(() =>
        db
          .insert(videos)
          .values({
            title: video.title,
            originalFootagePath: "",
            lessonId: null,
            ...(video.format ? { format: video.format } : {}),
          })
          .returning()
      );

      const videoResult = videoResults[0];

      if (!videoResult) {
        return yield* new UnknownDBServiceError({
          cause: "No video was returned from the database",
        });
      }

      return videoResult;
    }
  );

  const hasOriginalFootagePathAlreadyBeenUsed = Effect.fn(
    "hasOriginalFootagePathAlreadyBeenUsed"
  )(function* (originalFootagePath: string) {
    const foundVideo = yield* makeDbCall(() =>
      db.query.videos.findFirst({
        where: eq(videos.originalFootagePath, originalFootagePath),
      })
    );

    return !!foundVideo;
  });

  const updateVideo = Effect.fn("updateVideo")(function* (
    videoId: string,
    video: {
      originalFootagePath: string;
    }
  ) {
    yield* requireDraftVersionForVideo(db, videoId);
    const videoResult = yield* makeDbCall(() =>
      db.update(videos).set(video).where(eq(videos.id, videoId))
    );

    return videoResult;
  });

  const deleteVideo = Effect.fn("deleteVideo")(function* (videoId: string) {
    yield* requireDraftVersionForVideo(db, videoId);
    const videoResult = yield* makeDbCall(() =>
      db.update(videos).set({ archived: true }).where(eq(videos.id, videoId))
    );

    return videoResult;
  });

  const updateVideoTitle = Effect.fn("updateVideoTitle")(function* (opts: {
    videoId: string;
    title: string;
  }) {
    yield* requireDraftVersionForVideo(db, opts.videoId);
    const video = yield* makeDbCall(() =>
      db.query.videos.findFirst({
        where: eq(videos.id, opts.videoId),
        columns: { lessonId: true, title: true },
      })
    );

    if (video && video.lessonId && video.title !== opts.title) {
      yield* assertVideoTitleAvailable(
        video.lessonId,
        opts.title,
        opts.videoId
      );
    }

    yield* makeDbCall(() =>
      db
        .update(videos)
        .set({ title: opts.title, updatedAt: new Date() })
        .where(eq(videos.id, opts.videoId))
    );
  });

  const copyVideo = Effect.fn("copyVideo")(function* (opts: {
    sourceVideoId: string;
    newTitle: string;
    copyClips: boolean;
    copyBeats: boolean;
    copyScript: boolean;
    renameOld: boolean;
  }) {
    yield* requireDraftVersionForVideo(db, opts.sourceVideoId);
    return yield* copyVideoImpl(db, opts);
  });

  const updateVideoLesson = Effect.fn("updateVideoLesson")(function* (opts: {
    videoId: string;
    lessonId: string;
  }) {
    yield* requireDraftVersionForVideo(db, opts.videoId);
    yield* requireDraftVersionForLesson(db, opts.lessonId);
    yield* makeDbCall(() =>
      db
        .update(videos)
        .set({ lessonId: opts.lessonId, updatedAt: new Date() })
        .where(eq(videos.id, opts.videoId))
    );
  });

  const updateVideoArchiveStatus = Effect.fn("updateVideoArchiveStatus")(
    function* (opts: { videoId: string; archived: boolean }) {
      const { videoId, archived } = opts;

      // First verify the video is a standalone video (lessonId is NULL)
      const video = yield* makeDbCall(() =>
        db.query.videos.findFirst({
          where: eq(videos.id, videoId),
        })
      );

      if (!video) {
        return yield* new NotFoundError({
          type: "updateVideoArchiveStatus",
          params: { videoId },
        });
      }

      if (video.lessonId !== null) {
        return yield* new CannotArchiveLessonVideoError({
          videoId,
          lessonId: video.lessonId,
        });
      }

      const [updated] = yield* makeDbCall(() =>
        db
          .update(videos)
          .set({ archived })
          .where(eq(videos.id, videoId))
          .returning()
      );

      if (!updated) {
        return yield* new NotFoundError({
          type: "updateVideoArchiveStatus",
          params: { videoId },
        });
      }

      return updated;
    }
  );

  /**
   * Get the 3 most recent videos (by createdAt) that have 10+ unarchived clips.
   * Used for generating dynamic few-shot examples for next-clip suggestions.
   * Excludes the current video being edited.
   */
  const getVideosForFewShotExamples = Effect.fn("getVideosForFewShotExamples")(
    function* (excludeVideoId?: string) {
      // Get all non-archived videos with their non-archived clips
      const allVideos = yield* makeDbCall(() =>
        db.query.videos.findMany({
          where: eq(videos.archived, false),
          orderBy: desc(videos.createdAt),
          with: {
            clips: {
              orderBy: asc(clips.order),
              where: eq(clips.archived, false),
            },
          },
        })
      );

      // Filter to videos with 10+ clips, excluding the current video
      const eligibleVideos = allVideos
        .filter(
          (video) =>
            video.clips.length >= 10 &&
            (excludeVideoId === undefined || video.id !== excludeVideoId)
        )
        .slice(0, 3);

      return eligibleVideos;
    }
  );

  const getReferenceVideoCandidates = Effect.fn("getReferenceVideoCandidates")(
    function* (opts: { lessonId: string; excludeVideoId: string }) {
      const candidates = yield* makeDbCall(() =>
        db.query.videos.findMany({
          where: and(
            eq(videos.lessonId, opts.lessonId),
            eq(videos.archived, false),
            ne(videos.id, opts.excludeVideoId)
          ),
          columns: { id: true, title: true },
          with: {
            clips: {
              where: eq(clips.archived, false),
              orderBy: asc(clips.order),
              columns: {
                id: true,
                order: true,
                text: true,
                transcribedAt: true,
              },
            },
            chapters: {
              where: eq(chapters.archived, false),
              orderBy: asc(chapters.order),
              columns: { id: true, order: true, name: true },
            },
          },
        })
      );

      return candidates;
    }
  );

  return {
    getReferenceVideoCandidates,
    getVideoDeepById,
    getStandaloneVideos,
    getStandaloneVideosSidebar,
    getAllStandaloneVideos,
    getArchivedStandaloneVideos,
    getVideoWithClipsById,
    getVideoWithLessonById,
    getVideoScriptsByIds,
    createVideo,
    createStandaloneVideo,
    hasOriginalFootagePathAlreadyBeenUsed,
    updateVideo,
    deleteVideo,
    updateVideoTitle,
    copyVideo,
    updateVideoLesson,
    ...createVideoWriteOps(db),
    updateVideoArchiveStatus,
    ...createVideoNavigationOps({ getCourseNavigationData }),
    getVideosForFewShotExamples,
  };
};

/** Each write runs in one txn with its draft-guard's version-row lock (#1403). */
export const createVideoOperations = (db: Database, deps: VideoOpsDeps) =>
  transactionalizeWrites(
    db,
    (d) => createVideoOperationsUnwrapped(d, deps),
    videoWriteMethods
  );

export class VideoOperationsService extends Effect.Service<VideoOperationsService>()(
  "VideoOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      const courseOps = yield* CourseOperationsService;
      return createVideoOperations(db, {
        getCourseNavigationData: courseOps.getCourseNavigationData,
      });
    }),
    dependencies: [CourseOperationsService.Default],
  }
) {}
