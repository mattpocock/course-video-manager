import { Effect } from "effect";
import type { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import {
  type CourseRepoSyncValidationService,
  CourseRepoSyncError,
} from "./course-repo-sync-validation";

/**
 * Builds the post-write validation helpers used by CourseWriteService.
 *
 * `withPostValidation` runs sync validation AFTER the operation completes,
 * scoped to a single course. Pre-validation was removed because it doubled
 * filesystem I/O for every request — extremely slow on WSL 2 where each fs
 * call crosses the Linux/Windows bridge (~100ms+ per call). Validation is
 * scoped to the touched repo for the same reason.
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
    repoPathForSection,
    repoPathForLesson,
  };
}
