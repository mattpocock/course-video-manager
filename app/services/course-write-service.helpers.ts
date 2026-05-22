import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { execFileSync } from "node:child_process";
import type { CourseOperationsService } from "./db-course-operations.server";
import type { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import type { CourseRepoWriteService } from "./course-repo-write-service";
import { parseLessonPath, buildLessonPath } from "./lesson-path-service";
import {
  parseSectionPath,
  buildSectionPath,
  computeSectionRenumberingPlan,
} from "./section-path-service";
import { CourseWriteError } from "./course-write-service.types";

/**
 * Validates that a file path is an existing directory containing a git repo,
 * then assigns it to the given course in the database.
 */
export const validateAndAssignRepoPath = Effect.fn("validateAndAssignRepoPath")(
  function* (
    fileSystem: FileSystem.FileSystem,
    db: Pick<CourseOperationsService, "updateCourseFilePath">,
    repoId: string,
    filePath: string
  ) {
    const stat = yield* fileSystem.stat(filePath).pipe(
      Effect.catchAll(() =>
        Effect.fail(
          new CourseWriteError({
            cause: null,
            message: `File path does not exist: ${filePath}`,
          })
        )
      )
    );

    if (stat.type !== "Directory") {
      return yield* new CourseWriteError({
        cause: null,
        message: `File path is not a directory: ${filePath}`,
      });
    }

    yield* Effect.try({
      try: () =>
        execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
          cwd: filePath,
          stdio: "pipe",
        }),
      catch: () =>
        new CourseWriteError({
          cause: null,
          message: `Directory is not a git repository: ${filePath}`,
        }),
    });

    yield* db.updateCourseFilePath({ repoId, filePath });
  }
);

export function createSectionOps(
  db: LessonSectionOperationsService,
  repoWrite: CourseRepoWriteService
) {
  /**
   * Renumbers all sections for a repo version to ensure consistent
   * NN-slug numbering. Renames section directories and nested lesson
   * paths on disk, and updates DB records.
   *
   * Called after a ghost section materializes or dematerializes.
   */
  const renumberSections = Effect.fn("renumberSections")(function* (
    repoVersionId: string,
    repoPath: string
  ) {
    const allSections = yield* db.getSectionsByRepoVersionId(repoVersionId);

    const sectionRenames: Array<{
      id: string;
      oldPath: string;
      newPath: string;
      newSectionNumber: number;
    }> = [];

    // Only real (parseable) sections get sequential numbers;
    // ghost sections are skipped and don't reserve a number slot.
    let realNumber = 0;
    for (let i = 0; i < allSections.length; i++) {
      const section = allSections[i]!;
      const parsed = parseSectionPath(section.path);
      if (!parsed) continue; // skip ghost sections (unparseable paths)

      realNumber++;
      if (parsed.sectionNumber !== realNumber) {
        const newPath = buildSectionPath(realNumber, parsed.slug);
        sectionRenames.push({
          id: section.id,
          oldPath: section.path,
          newPath,
          newSectionNumber: realNumber,
        });
      }
    }

    if (sectionRenames.length === 0) return;

    // Check which sections have directories on disk
    const sectionsWithDir = new Set<string>();
    for (const rename of sectionRenames) {
      const exists = yield* repoWrite.sectionDirExists({
        repoPath,
        sectionPath: rename.oldPath,
      });
      if (exists) {
        sectionsWithDir.add(rename.id);
      }
    }

    const fsRenames = sectionRenames.filter((r) => sectionsWithDir.has(r.id));

    if (fsRenames.length > 0) {
      yield* repoWrite.renameSections({
        repoPath,
        renames: fsRenames.map((r) => ({
          oldPath: r.oldPath,
          newPath: r.newPath,
        })),
      });
    }

    // Update DB paths for all renamed sections
    for (const rename of sectionRenames) {
      yield* db.updateSectionPath(rename.id, rename.newPath);
    }

    // Rename lessons within each renamed section
    for (const sectionRename of sectionRenames) {
      const sectionLessons = yield* db.getLessonsBySectionId(sectionRename.id);
      const realLessons = sectionLessons.filter((l) => l.fsStatus !== "ghost");

      if (realLessons.length === 0) continue;

      const lessonRenames: Array<{
        id: string;
        oldPath: string;
        newPath: string;
      }> = [];
      for (const lesson of realLessons) {
        const lParsed = parseLessonPath(lesson.path);
        if (!lParsed) continue;

        const newLessonPath = buildLessonPath(
          sectionRename.newSectionNumber,
          lParsed.lessonNumber,
          lParsed.slug
        );
        if (newLessonPath !== lesson.path) {
          lessonRenames.push({
            id: lesson.id,
            oldPath: lesson.path,
            newPath: newLessonPath,
          });
        }
      }

      if (lessonRenames.length > 0) {
        yield* repoWrite.renameLessons({
          repoPath,
          sectionPath: sectionRename.newPath,
          renames: lessonRenames.map((r) => ({
            oldPath: r.oldPath,
            newPath: r.newPath,
          })),
        });

        for (const rename of lessonRenames) {
          yield* db.updateLesson(rename.id, { path: rename.newPath });
        }
      }
    }
  });

  /**
   * Reorders sections within a repo version.
   * Renames section directories on disk, updates DB section paths,
   * renames nested lesson directories to match new section number prefix,
   * updates DB lesson paths, and updates section order for all sections.
   */
  const reorderSections = Effect.fn("reorderSections")(function* (
    sectionIds: readonly string[]
  ) {
    // Get all sections to compute renumbering plan
    const allSections = yield* db.getSectionsByIds(sectionIds);
    const sectionsForReorder = allSections.map((s) => ({
      id: s.id,
      path: s.path,
    }));

    // Get repo path from the first section's hierarchy
    const firstSection = yield* db.getSectionWithHierarchyById(sectionIds[0]!);
    const repoPath = firstSection.repoVersion.repo.filePath!;

    // Compute which section directories need filesystem renames
    const sectionRenames = computeSectionRenumberingPlan(
      sectionsForReorder,
      sectionIds
    );

    if (sectionRenames.length > 0) {
      // Determine which sections have directories on disk
      const sectionsWithDir = new Set<string>();
      for (const rename of sectionRenames) {
        const exists = yield* repoWrite.sectionDirExists({
          repoPath,
          sectionPath: rename.oldPath,
        });
        if (exists) {
          sectionsWithDir.add(rename.id);
        }
      }

      const fsRenames = sectionRenames.filter((r) => sectionsWithDir.has(r.id));

      // Execute git mv only for sections with directories on disk
      if (fsRenames.length > 0) {
        yield* repoWrite.renameSections({
          repoPath,
          renames: fsRenames.map((r) => ({
            oldPath: r.oldPath,
            newPath: r.newPath,
          })),
        });
      }

      // Update DB paths for ALL renamed sections (including ghost-only)
      for (const rename of sectionRenames) {
        yield* db.updateSectionPath(rename.id, rename.newPath);
      }

      // Rename lessons within each renamed section to update their XX prefix
      for (const sectionRename of sectionRenames) {
        const sectionLessons = yield* db.getLessonsBySectionId(
          sectionRename.id
        );
        const realLessons = sectionLessons.filter(
          (l) => l.fsStatus !== "ghost"
        );

        if (realLessons.length === 0) continue;

        // Compute lesson renames: update the section number prefix
        const lessonRenames: Array<{ oldPath: string; newPath: string }> = [];
        for (const lesson of realLessons) {
          const parsed = parseLessonPath(lesson.path);
          if (!parsed) continue;

          const newLessonPath = buildLessonPath(
            sectionRename.newSectionNumber,
            parsed.lessonNumber,
            parsed.slug
          );
          if (newLessonPath !== lesson.path) {
            lessonRenames.push({
              oldPath: lesson.path,
              newPath: newLessonPath,
            });
          }
        }

        if (lessonRenames.length > 0) {
          // Execute git mv for lessons within the renamed section
          yield* repoWrite.renameLessons({
            repoPath,
            sectionPath: sectionRename.newPath,
            renames: lessonRenames,
          });

          // Update DB paths for renamed lessons
          for (const lesson of realLessons) {
            const parsed = parseLessonPath(lesson.path);
            if (!parsed) continue;

            const newLessonPath = buildLessonPath(
              sectionRename.newSectionNumber,
              parsed.lessonNumber,
              parsed.slug
            );
            if (newLessonPath !== lesson.path) {
              yield* db.updateLesson(lesson.id, {
                path: newLessonPath,
                lessonNumber: parsed.lessonNumber,
              });
            }
          }
        }
      }
    }

    // Update the order field for each section in a single query
    yield* db.batchUpdateSectionOrders(
      sectionIds.map((id, i) => ({ id, order: i }))
    );

    return { success: true };
  });

  /**
   * Renames a section's slug (preserves section number).
   * Renames the section directory on disk via git mv,
   * updates DB section path, and renames nested real lesson
   * directories to match the new section number prefix.
   */
  const renameSection = Effect.fn("renameSection")(function* (
    sectionId: string,
    newSlug: string
  ) {
    const section = yield* db.getSectionWithHierarchyById(sectionId);
    const parsed = parseSectionPath(section.path);

    if (!parsed) {
      return yield* new CourseWriteError({
        cause: null,
        message: `Cannot parse section path: ${section.path}`,
      });
    }

    if (parsed.slug === newSlug) {
      return { success: true, path: section.path };
    }

    const repoPath = section.repoVersion.repo.filePath!;
    const newPath = buildSectionPath(parsed.sectionNumber, newSlug);

    // Rename section directory on disk
    yield* repoWrite.renameSections({
      repoPath,
      renames: [{ oldPath: section.path, newPath }],
    });

    // Update DB section path
    yield* db.updateSectionPath(sectionId, newPath);

    return { success: true, path: newPath };
  });

  return { renumberSections, reorderSections, renameSection };
}
