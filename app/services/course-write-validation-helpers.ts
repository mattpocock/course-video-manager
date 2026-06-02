import { Effect } from "effect";
import type { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import {
  type CourseRepoSyncValidationService,
  CourseRepoSyncError,
} from "./course-repo-sync-validation";

/**
 * Builds validation helpers used by CourseWriteService.
 *
 * Two wrappers:
 * - `withPostValidation` — post-write only, for conditionally-FS operations
 *   that gate validation internally.
 * - `withPreAndPostValidation` — pre-flight gate + post-write, for
 *   always-filesystem operations. The pre-flight refuses to act on an
 *   already-divergent repo; the post-write catches divergence the write's
 *   own logic might introduce. This accepts two full repo scans per
 *   filesystem write as the cost of both guarantees.
 *
 * Validation is scoped to the touched repo to avoid O(courses) FS traversals.
 */
export function createValidationHelpers(
  lessonSectionOps: LessonSectionOperationsService,
  syncService: CourseRepoSyncValidationService
) {
  const runValidation = (repoPath: string | null) =>
    syncService.validate({ repoPath }).pipe(
      Effect.catchAll((e) => {
        if (e._tag === "CourseRepoSyncError") return Effect.fail(e);
        return Effect.fail(
          new CourseRepoSyncError({
            cause: e,
            message: `Sync validation encountered an error: ${String(e)}`,
          })
        );
      })
    );

  const withPostValidation = <A, E1, E2, R1, R2>(
    resolveRepoPath: Effect.Effect<string | null, E1, R1>,
    effect: Effect.Effect<A, E2, R2>
  ): Effect.Effect<A, E1 | E2 | CourseRepoSyncError, R1 | R2> =>
    Effect.gen(function* () {
      const result = yield* effect;
      const repoPath = yield* resolveRepoPath;
      yield* runValidation(repoPath);
      return result;
    });

  const withPreAndPostValidation = <A, E1, E2, R1, R2>(
    resolveRepoPath: Effect.Effect<string | null, E1, R1>,
    effect: Effect.Effect<A, E2, R2>
  ): Effect.Effect<A, E1 | E2 | CourseRepoSyncError, R1 | R2> =>
    Effect.gen(function* () {
      const repoPath = yield* resolveRepoPath;
      yield* runValidation(repoPath);
      const result = yield* effect;
      yield* runValidation(repoPath);
      return result;
    });

  const repoPathForSection = (sectionId: string) =>
    lessonSectionOps
      .getSectionWithHierarchyById(sectionId)
      .pipe(Effect.map((s) => s.repoVersion.repo.filePath));

  const repoPathForLesson = (lessonId: string) =>
    lessonSectionOps
      .getLessonWithHierarchyById(lessonId)
      .pipe(Effect.map((l) => l.section.repoVersion.repo.filePath));

  return {
    runValidation,
    withPostValidation,
    withPreAndPostValidation,
    repoPathForSection,
    repoPathForLesson,
  };
}
