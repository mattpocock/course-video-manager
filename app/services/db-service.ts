import { db } from "@/db/db";
import { lessons, repos, sections, videos } from "@/db/schema";
import { asc, eq, ilike } from "drizzle-orm";
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
          db.update(lessons).set(lesson).where(eq(lessons.id, lessonId))
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
