import {
  DrizzleService,
  type Database,
} from "@/services/drizzle-service.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { clips, chapters, videos } from "@/db/schema";
import {
  CannotArchiveLessonVideoError,
  NotFoundError,
  UnknownDBServiceError,
  VideoTitleTakenError,
} from "@/services/db-service-errors";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { Effect } from "effect";
import { copyVideoImpl } from "@/services/db-video-operations.copy.server";
import { createVideoWriteOps } from "@/services/db-video-operations.write.server";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createVideoOperations = (
  db: Database,
  deps: {
    getCourseNavigationData: (id: string) => Effect.Effect<any, any>;
  }
) => {
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
    function* () {
      const standaloneVideos = yield* makeDbCall(() =>
        db.query.videos.findMany({
          where: and(
            isNull(videos.lessonId),
            isNull(videos.pitchId),
            eq(videos.archived, false)
          ),
          orderBy: desc(videos.updatedAt),
          with: {
            clips: {
              orderBy: asc(clips.order),
              where: eq(clips.archived, false),
            },
          },
        })
      );

      return standaloneVideos;
    }
  );

  const getArchivedStandaloneVideos = Effect.fn("getArchivedStandaloneVideos")(
    function* () {
      const archivedVideos = yield* makeDbCall(() =>
        db.query.videos.findMany({
          where: and(
            isNull(videos.lessonId),
            isNull(videos.pitchId),
            eq(videos.archived, true)
          ),
          orderBy: desc(videos.createdAt),
          with: {
            clips: {
              orderBy: asc(clips.order),
              where: eq(clips.archived, false),
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
              diagramSnapshot: {
                with: {
                  diagram: {
                    columns: { name: true },
                  },
                },
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
    function* (video: { title: string }) {
      const videoResults = yield* makeDbCall(() =>
        db
          .insert(videos)
          .values({
            title: video.title,
            originalFootagePath: "",
            lessonId: null,
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
    const videoResult = yield* makeDbCall(() =>
      db.update(videos).set(video).where(eq(videos.id, videoId))
    );

    return videoResult;
  });

  const deleteVideo = Effect.fn("deleteVideo")(function* (videoId: string) {
    const videoResult = yield* makeDbCall(() =>
      db.update(videos).set({ archived: true }).where(eq(videos.id, videoId))
    );

    return videoResult;
  });

  const updateVideoTitle = Effect.fn("updateVideoTitle")(function* (opts: {
    videoId: string;
    title: string;
  }) {
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
  }) {
    return yield* copyVideoImpl(db, opts);
  });

  const updateVideoLesson = Effect.fn("updateVideoLesson")(function* (opts: {
    videoId: string;
    lessonId: string;
  }) {
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

  const getNextVideoId = Effect.fn("getNextVideoId")(function* (currentVideo: {
    id: string;
    lesson: {
      id: string;
      videos: Array<{ id: string; title: string }>;
      section: { repoVersion: { repo: { id: string } } };
    } | null;
  }) {
    const currentLesson = currentVideo.lesson;
    if (!currentLesson) return null; // Standalone videos have no next/prev
    const repo = currentLesson.section.repoVersion.repo;

    // Get all videos in current lesson sorted by title
    const videosInLesson = [...currentLesson.videos].sort((a, b) =>
      a.title.localeCompare(b.title)
    );
    const currentVideoIndex = videosInLesson.findIndex(
      (v) => v.id === currentVideo.id
    );

    // Try next video in current lesson
    if (currentVideoIndex < videosInLesson.length - 1) {
      return videosInLesson[currentVideoIndex + 1]?.id ?? null;
    }

    // Need to get all sections and lessons to find next
    const courseNav = yield* getCourseNavigationData(repo.id);
    const latestVersionSections = courseNav.versions[0]?.sections ?? [];

    // Build a flat list of real lessons in order
    const allRealLessons = latestVersionSections.flatMap(
      (s: (typeof latestVersionSections)[number]) => s.lessons
    );

    const currentIndex = allRealLessons.findIndex(
      (l: (typeof allRealLessons)[number]) => l.id === currentLesson.id
    );

    for (let i = currentIndex + 1; i < allRealLessons.length; i++) {
      const nextLesson = allRealLessons[i]!;
      const firstVideo = nextLesson.videos.sort(
        (a: { title: string }, b: { title: string }) =>
          a.title.localeCompare(b.title)
      )[0];
      if (firstVideo) return firstVideo.id;
    }

    return null;
  });

  const getPreviousVideoId = Effect.fn("getPreviousVideoId")(
    function* (currentVideo: {
      id: string;
      lesson: {
        id: string;
        videos: Array<{ id: string; title: string }>;
        section: { repoVersion: { repo: { id: string } } };
      } | null;
    }) {
      const currentLesson = currentVideo.lesson;
      if (!currentLesson) return null; // Standalone videos have no next/prev
      const repo = currentLesson.section.repoVersion.repo;

      // Get all videos in current lesson sorted by title
      const videosInLesson = [...currentLesson.videos].sort((a, b) =>
        a.title.localeCompare(b.title)
      );
      const currentVideoIndex = videosInLesson.findIndex(
        (v) => v.id === currentVideo.id
      );

      // Try previous video in current lesson
      if (currentVideoIndex > 0) {
        return videosInLesson[currentVideoIndex - 1]?.id ?? null;
      }

      // Need to get all sections and lessons to find previous
      const courseNav = yield* getCourseNavigationData(repo.id);
      const latestVersionSections = courseNav.versions[0]?.sections ?? [];

      const allRealLessons = latestVersionSections.flatMap(
        (s: (typeof latestVersionSections)[number]) => s.lessons
      );

      const currentIndex = allRealLessons.findIndex(
        (l: (typeof allRealLessons)[number]) => l.id === currentLesson.id
      );

      // Find previous real lesson with videos
      for (let i = currentIndex - 1; i >= 0; i--) {
        const prevLesson = allRealLessons[i]!;
        const videos = prevLesson.videos.sort(
          (a: { title: string }, b: { title: string }) =>
            a.title.localeCompare(b.title)
        );
        const lastVideo = videos[videos.length - 1];
        if (lastVideo) return lastVideo.id;
      }

      return null;
    }
  );

  /**
   * Gets the next lesson that has no videos, starting from the current video's lesson.
   * Returns lesson info if found, null if no such lesson exists.
   */
  const getNextLessonWithoutVideo = Effect.fn("getNextLessonWithoutVideo")(
    function* (currentVideo: {
      lesson: {
        id: string;
        section: {
          repoVersion: {
            repo: { id: string };
          };
        };
      } | null;
    }) {
      const currentLesson = currentVideo.lesson;
      if (!currentLesson) return null; // Standalone videos have no next/prev

      const currentSection = currentLesson.section;
      const repo = currentSection.repoVersion.repo;

      // Need to get all sections and lessons to find next lesson without video.
      // Use the slim navigation query (no clips) — we only need video counts.
      const repoWithVersions = yield* getCourseNavigationData(repo.id);
      const latestVersionSections =
        repoWithVersions.versions[0]?.sections ?? [];

      // Find current lesson in the structure
      for (let sIdx = 0; sIdx < latestVersionSections.length; sIdx++) {
        const section = latestVersionSections[sIdx]!;
        for (let lIdx = 0; lIdx < section.lessons.length; lIdx++) {
          const lesson = section.lessons[lIdx]!;
          if (lesson.id === currentLesson.id) {
            // Search for next lesson with no videos, starting from next lesson
            // First check remaining lessons in current section
            for (
              let nextLIdx = lIdx + 1;
              nextLIdx < section.lessons.length;
              nextLIdx++
            ) {
              const nextLesson = section.lessons[nextLIdx]!;
              if (nextLesson.videos.length === 0) {
                return {
                  lessonId: nextLesson.id,
                  lessonTitle: nextLesson.title,
                  sectionPath: section.title,
                };
              }
            }

            // Then check lessons in subsequent sections
            for (
              let nextSIdx = sIdx + 1;
              nextSIdx < latestVersionSections.length;
              nextSIdx++
            ) {
              const nextSection = latestVersionSections[nextSIdx]!;
              for (const nextLesson of nextSection.lessons) {
                if (nextLesson.videos.length === 0) {
                  return {
                    lessonId: nextLesson.id,
                    lessonTitle: nextLesson.title,
                    sectionPath: nextSection.title,
                  };
                }
              }
            }

            // No lesson without video found
            return null;
          }
        }
      }

      return null;
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
    getNextVideoId,
    getPreviousVideoId,
    getNextLessonWithoutVideo,
    getVideosForFewShotExamples,
  };
};

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
