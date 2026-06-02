import { Effect } from "effect";
import type { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import {
  type CourseRepoSyncValidationService,
  CourseRepoSyncError,
} from "./course-repo-sync-validation";

/**
 * Builds validation helpers used by CourseWriteService.
 *
 * Every filesystem-touching write runs both a pre-flight gate and a post-write
 * validation. The pre-flight refuses to act on an already-divergent repo; the
 * post-write catches divergence the write's own logic might introduce. This
 * accepts two full repo scans per filesystem write as the cost of both
 * guarantees.
 *
 * Always-FS operations use `withPreAndPostValidation`; conditionally-FS
 * operations (delete, rename, move, convert-to-ghost) call `runValidation`
 * directly inside their filesystem-touch branches so ghost-only edits pay
 * nothing.
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
    withPreAndPostValidation,
    repoPathForSection,
    repoPathForLesson,
  };
}
