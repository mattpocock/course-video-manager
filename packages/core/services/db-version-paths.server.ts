import { type Database } from "./drizzle-service.server.js";
import { lessons, sections } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, asc, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { projectVersionPaths } from "./path-projection.js";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });

/**
 * Version-scoped derived-path resolvers, split out of
 * db-version-operations.server.ts for the repo's per-file token budget (same
 * pattern as db-version-lifecycle.server.ts). Spread into
 * VersionOperationsService's returned object.
 */
export const createVersionPathOps = (db: Database) => {
  // Minimal sibling tree used to project version-scoped paths.
  const loadVersionTreeForProjection = (repoVersionId: string) =>
    makeDbCall(() =>
      db.query.sections.findMany({
        where: and(
          eq(sections.repoVersionId, repoVersionId),
          isNull(sections.archivedAt)
        ),
        orderBy: asc(sections.order),
        columns: { id: true, order: true, title: true },
        with: {
          lessons: {
            where: eq(lessons.archived, false),
            orderBy: asc(lessons.order),
            columns: { id: true, order: true, title: true },
          },
        },
      })
    );

  // Resolve one lesson's derived directory from its version siblings.
  const resolveLessonDir = Effect.fn("resolveLessonDir")(function* (
    lessonId: string
  ) {
    const lesson = yield* makeDbCall(() =>
      db.query.lessons.findFirst({
        where: eq(lessons.id, lessonId),
        columns: { id: true },
        with: { section: { columns: { id: true, repoVersionId: true } } },
      })
    );

    if (!lesson) {
      return yield* new NotFoundError({
        type: "resolveLessonDir",
        params: { lessonId },
      });
    }

    const versionSections = yield* loadVersionTreeForProjection(
      lesson.section.repoVersionId
    );
    const paths = projectVersionPaths(versionSections);
    const sectionPath = paths.get(lesson.section.id);
    const lessonPath = paths.get(lessonId);

    if (!sectionPath || !lessonPath) {
      return yield* new NotFoundError({
        type: "resolveLessonDir",
        params: { lessonId },
      });
    }

    return `${sectionPath}/${lessonPath}`;
  });

  // Resolve one section's derived directory from its version siblings.
  const resolveSectionDir = Effect.fn("resolveSectionDir")(function* (
    sectionId: string
  ) {
    const section = yield* makeDbCall(() =>
      db.query.sections.findFirst({
        where: eq(sections.id, sectionId),
        columns: { id: true, repoVersionId: true },
      })
    );

    if (!section) {
      return yield* new NotFoundError({
        type: "resolveSectionDir",
        params: { sectionId },
      });
    }

    const versionSections = yield* loadVersionTreeForProjection(
      section.repoVersionId
    );
    const paths = projectVersionPaths(versionSections);
    const sectionPath = paths.get(sectionId);

    if (!sectionPath) {
      return yield* new NotFoundError({
        type: "resolveSectionDir",
        params: { sectionId },
      });
    }

    return sectionPath;
  });

  return {
    resolveLessonDir,
    resolveSectionDir,
  };
};
