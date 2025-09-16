import { db } from "@/db/db";
import { clips, lessons, repos, sections, videos } from "@/db/schema";
import { generateNKeysBetween } from "fractional-indexing";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { Data, Effect } from "effect";

class NotFoundError extends Data.TaggedError("NotFoundError")<{
  type: string;
  params: object;
}> {}

class UnknownDBServiceError extends Data.TaggedError("UnknownDBServiceError")<{
  cause: unknown;
}> {}

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export class DBService extends Effect.Service<DBService>()("DBService", {
  effect: Effect.gen(function* () {
    const getClipById = Effect.fn("getClipById")(function* (clipId: string) {
      const clip = yield* makeDbCall(() =>
        db.query.clips.findFirst({
          where: eq(clips.id, clipId),
        })
      );

      if (!clip) {
        return yield* new NotFoundError({
          type: "getClipById",
          params: { clipId },
        });
      }

      return clip;
    });

    const getClipsByIds = Effect.fn("getClipsByIds")(function* (
      clipIds: readonly string[]
    ) {
      const foundClips = yield* makeDbCall(() =>
        db.query.clips.findMany({
          where: inArray(clips.id, clipIds),
        })
      );

      return foundClips;
    });

    const updateClip = Effect.fn("updateClip")(function* (
      clipId: string,
      updatedClip: {
        text?: string;
        scene?: string;
        transcribedAt?: Date;
      }
    ) {
      const [clip] = yield* makeDbCall(() =>
        db
          .update(clips)
          .set(updatedClip)
          .where(eq(clips.id, clipId))
          .returning()
      );

      return clip!;
    });

    const archiveClip = Effect.fn("archiveClip")(function* (clipId: string) {
      const clipExists = yield* makeDbCall(() =>
        db.query.clips.findFirst({
          where: eq(clips.id, clipId),
        })
      );

      if (!clipExists) {
        return yield* new NotFoundError({
          type: "archiveClip",
          params: { clipId },
        });
      }

      const clip = yield* makeDbCall(() =>
        db.update(clips).set({ archived: true }).where(eq(clips.id, clipId))
      );

      return clip;
    });

    const getRepoById = Effect.fn("getRepoById")(function* (id: string) {
      const repo = yield* makeDbCall(() =>
        db.query.repos.findFirst({
          where: eq(repos.id, id),
        })
      );

      if (!repo) {
        return yield* new NotFoundError({
          type: "getRepo",
          params: { id },
        });
      }

      return repo;
    });

    const getRepoByFilePath = Effect.fn("getRepoByFilePath")(function* (
      filePath: string
    ) {
      const repo = yield* makeDbCall(() =>
        db.query.repos.findFirst({
          where: eq(repos.filePath, filePath),
        })
      );

      if (!repo) {
        return yield* new NotFoundError({
          type: "getRepoByFilePath",
          params: { filePath },
        });
      }

      return repo;
    });

    const getLessonById = Effect.fn("getLessonById")(function* (id: string) {
      const lesson = yield* makeDbCall(() =>
        db.query.lessons.findFirst({
          where: eq(lessons.id, id),
          with: {
            videos: {
              orderBy: asc(videos.path),
            },
          },
        })
      );

      if (!lesson) {
        return yield* new NotFoundError({
          type: "getLessonById",
          params: { id },
        });
      }

      return lesson;
    });

    const getVideoDeepById = Effect.fn("getVideoById")(function* (id: string) {
      const video = yield* makeDbCall(() =>
        db.query.videos.findFirst({
          where: eq(videos.id, id),
          with: {
            lesson: {
              with: {
                section: {
                  with: {
                    repo: true,
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
                    repo: true,
                  },
                },
              },
            },
            clips: {
              orderBy: asc(clips.order),
              ...(opts?.withArchived
                ? {}
                : { where: eq(clips.archived, false) }),
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

    const getRepoWithSectionsById = Effect.fn("getRepoWithSectionsById")(
      function* (id: string) {
        const repo = yield* makeDbCall(() =>
          db.query.repos.findFirst({
            where: eq(repos.id, id),
            with: {
              sections: {
                with: {
                  lessons: {
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
                    orderBy: asc(lessons.order),
                  },
                },
                orderBy: asc(sections.order),
              },
            },
          })
        );

        if (!repo) {
          return yield* new NotFoundError({
            type: "getRepoWithSections",
            params: { id },
          });
        }

        return repo;
      }
    );

    return {
      getClipById,
      getClipsByIds,
      updateClip,
      getLessonById,
      appendClips: Effect.fn("addClips")(function* (
        videoId: string,
        inputClips: readonly {
          inputVideo: string;
          startTime: number;
          endTime: number;
        }[]
      ) {
        const lastClip = yield* makeDbCall(() =>
          db.query.clips.findFirst({
            where: eq(clips.videoId, videoId),
            orderBy: desc(clips.order),
          })
        );

        const order = generateNKeysBetween(
          lastClip?.order,
          null,
          inputClips.length,
          digits
        );

        const clipsResult = yield* makeDbCall(() =>
          db
            .insert(clips)
            .values(
              inputClips.map((clip, index) => ({
                ...clip,
                videoId,
                videoFilename: clip.inputVideo,
                sourceStartTime: clip.startTime,
                sourceEndTime: clip.endTime,
                order: order[index]!,
                archived: false,
                text: "",
              }))
            )
            .returning()
        );

        return clipsResult;
      }),
      createVideo: Effect.fn("createVideo")(function* (
        lessonId: string,
        video: {
          path: string;
          originalFootagePath: string;
        }
      ) {
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
      }),
      hasOriginalFootagePathAlreadyBeenUsed: Effect.fn(
        "hasOriginalFootagePathAlreadyBeenUsed"
      )(function* (originalFootagePath: string) {
        const foundVideo = yield* makeDbCall(() =>
          db.query.videos.findFirst({
            where: eq(videos.originalFootagePath, originalFootagePath),
          })
        );

        return !!foundVideo;
      }),
      updateVideo: Effect.fn("updateVideo")(function* (
        videoId: string,
        video: {
          originalFootagePath: string;
        }
      ) {
        const videoResult = yield* makeDbCall(() =>
          db.update(videos).set(video).where(eq(videos.id, videoId))
        );

        return videoResult;
      }),
      deleteVideo: Effect.fn("deleteVideo")(function* (videoId: string) {
        const videoResult = yield* makeDbCall(() =>
          db.delete(videos).where(eq(videos.id, videoId))
        );

        return videoResult;
      }),
      getRepoById,
      getRepoByFilePath,
      getRepoWithSectionsById,
      getRepoWithSectionsByFilePath: Effect.fn("getRepoWithSectionsByFilePath")(
        function* (filePath: string) {
          const repo = yield* getRepoByFilePath(filePath);

          return yield* getRepoWithSectionsById(repo.id);
        }
      ),
      getRepos: Effect.fn("getRepos")(function* () {
        const repos = yield* makeDbCall(() => db.query.repos.findMany());
        return repos;
      }),
      archiveClip,
      getVideoById: getVideoDeepById,
      getVideoWithClipsById: getVideoWithClipsById,
      createRepo: Effect.fn("createRepo")(function* (filePath: string) {
        const reposResult = yield* makeDbCall(() =>
          db.insert(repos).values({ filePath }).returning()
        );

        const repo = reposResult[0];

        if (!repo) {
          return yield* new UnknownDBServiceError({
            cause: "No repo was returned from the database",
          });
        }

        return repo;
      }),
      createSections: Effect.fn("createSections")(function* (
        repoId: string,
        newSections: {
          sectionPathWithNumber: string;
          sectionNumber: number;
        }[]
      ) {
        const sectionResult = yield* makeDbCall(() =>
          db
            .insert(sections)
            .values(
              newSections.map((section) => ({
                repoId,
                path: section.sectionPathWithNumber,
                order: section.sectionNumber,
              }))
            )
            .returning()
        );

        return sectionResult;
      }),

      createLessons: Effect.fn("createLessons")(function* (
        sectionId: string,
        newLessons: {
          lessonPathWithNumber: string;
          lessonNumber: number;
        }[]
      ) {
        const lessonResult = yield* makeDbCall(() =>
          db
            .insert(lessons)
            .values(
              newLessons.map((lesson) => ({
                sectionId,
                path: lesson.lessonPathWithNumber,
                order: lesson.lessonNumber,
              }))
            )
            .returning()
        );

        return lessonResult;
      }),
      updateLesson: Effect.fn("updateLesson")(function* (
        lessonId: string,
        lesson: {
          path: string;
          sectionId: string;
          lessonNumber: number;
        }
      ) {
        const lessonResult = yield* makeDbCall(() =>
          db
            .update(lessons)
            .set({
              path: lesson.path,
              sectionId: lesson.sectionId,
              order: lesson.lessonNumber,
            })
            .where(eq(lessons.id, lessonId))
        );

        return lessonResult;
      }),
      deleteLesson: Effect.fn("deleteLesson")(function* (lessonId: string) {
        const lessonResult = yield* makeDbCall(() =>
          db.delete(lessons).where(eq(lessons.id, lessonId))
        );

        return lessonResult;
      }),
      deleteSection: Effect.fn("deleteSection")(function* (sectionId: string) {
        const sectionResult = yield* makeDbCall(() =>
          db.delete(sections).where(eq(sections.id, sectionId))
        );

        return sectionResult;
      }),
    };
  }),
}) {}

const digits = "0123456789abcdefghijklmnopqrstuvwxyz";
