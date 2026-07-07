import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { CourseOperationsService } from "./db-course-operations.server";
import { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import { CourseRepoWriteService } from "./course-repo-write-service";
import {
  toSlug,
  computeRenumberingPlan,
  parseLessonPath,
  buildLessonPath,
} from "./lesson-path-service";
import { parseSectionPath } from "./section-path-service";
import { projectVersionPaths } from "./path-projection";
import { createSectionOps } from "./course-write-service.helpers";
import { createMoveOps } from "./course-write-move-ops";
import { createMaterializeOps } from "./course-write-materialize-ops";
import { CourseWriteError } from "./course-write-service.types";
import { CourseRepoSyncValidationService } from "./course-repo-sync-validation";
import { createValidationHelpers } from "./course-write-validation-helpers";
import { statusForConvertToGhost } from "./lesson-authoring-status";

export { CourseWriteError } from "./course-write-service.types";
export { CourseRepoSyncError } from "./course-repo-sync-validation";

const titleCaseFromSlug = (slug: string): string =>
  slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export class CourseWriteService extends Effect.Service<CourseWriteService>()(
  "CourseWriteService",
  {
    effect: Effect.gen(function* () {
      const lessonSectionOps = yield* LessonSectionOperationsService;
      const courseOps = yield* CourseOperationsService;
      const repoWrite = yield* CourseRepoWriteService;
      const syncService = yield* CourseRepoSyncValidationService;
      const fileSystem = yield* FileSystem.FileSystem;

      const {
        runValidation,
        withPreAndPostValidation,
        repoPathForSection,
        repoPathForLesson,
      } = createValidationHelpers(lessonSectionOps, syncService);

      const { renumberSections, reorderSections, renameSection } =
        createSectionOps(lessonSectionOps, repoWrite);

      const addGhostSection = Effect.fn("addGhostSection")(function* (
        repoVersionId: string,
        title: string,
        maxOrder: number = 0,
        opts?: { adjacentSectionId: string; position: "before" | "after" }
      ) {
        let sectionNumber = maxOrder + 1;

        if (opts) {
          const sections =
            yield* lessonSectionOps.getSectionsByRepoVersionId(repoVersionId);
          const adjIdx = sections.findIndex(
            (s) => s.id === opts.adjacentSectionId
          );
          if (adjIdx !== -1) {
            const idx = opts.position === "after" ? adjIdx + 1 : adjIdx;
            const shiftUpdates = sections
              .slice(idx)
              .map((s) => ({ id: s.id, order: s.order + 1 }));
            yield* lessonSectionOps.batchUpdateSectionOrders(shiftUpdates);
            sectionNumber = sections[idx]
              ? sections[idx]!.order
              : Math.max(...sections.map((s) => s.order)) + 1;
          }
        }

        const [newSection] = yield* lessonSectionOps.createSections({
          repoVersionId,
          sections: [
            {
              sectionPathWithNumber: title,
              sectionNumber,
            },
          ],
        });

        return { success: true, sectionId: newSection!.id };
      });

      const {
        createRealLesson,
        materializeGhost,
        materializeCourseWithLesson,
      } = createMaterializeOps(
        lessonSectionOps,
        courseOps,
        repoWrite,
        fileSystem,
        renumberSections
      );

      const addGhostLesson = Effect.fn("addGhostLesson")(function* (
        sectionId: string,
        title: string,
        opts?: { adjacentLessonId?: string; position?: "before" | "after" }
      ) {
        const lessons =
          yield* lessonSectionOps.getLessonsBySectionId(sectionId);
        const maxOrder =
          lessons.length > 0 ? Math.max(...lessons.map((l) => l.order)) : 0;
        let insertOrder = maxOrder + 1;

        if (opts?.adjacentLessonId && opts?.position) {
          const adjIdx = lessons.findIndex(
            (l) => l.id === opts.adjacentLessonId
          );
          if (adjIdx !== -1) {
            const idx = opts.position === "after" ? adjIdx + 1 : adjIdx;
            const shiftUpdates = lessons
              .slice(idx)
              .map((l) => ({ id: l.id, order: l.order + 1 }));
            yield* lessonSectionOps.batchUpdateLessonOrders(shiftUpdates);
            insertOrder = lessons[idx] ? lessons[idx]!.order : maxOrder + 1;
          }
        }

        const [newLesson] = yield* lessonSectionOps.createGhostLesson(
          sectionId,
          {
            title,
            path: toSlug(title) || "untitled",
            order: insertOrder,
          }
        );
        return { success: true, lessonId: newLesson!.id };
      });

      const deleteLesson = Effect.fn("deleteLesson")(function* (
        lessonId: string
      ) {
        const lesson =
          yield* lessonSectionOps.getLessonWithHierarchyById(lessonId);

        if (lesson.fsStatus !== "ghost") {
          const repoPath = lesson.section.repoVersion.repo.filePath!;
          const versionTree =
            yield* lessonSectionOps.getSectionsWithLessonsByRepoVersionId(
              lesson.section.repoVersionId
            );
          const derivedPaths = projectVersionPaths(versionTree);
          const sectionPath = derivedPaths.get(lesson.sectionId)!;
          const parsed = parseSectionPath(sectionPath);
          const sectionNumber = parsed?.sectionNumber ?? 1;

          yield* runValidation(repoPath);

          yield* repoWrite.deleteLesson({
            repoPath,
            sectionPath,
            lessonDirName: derivedPaths.get(lessonId)!,
          });

          // Archive before renumbering so it's excluded from the sibling list
          yield* lessonSectionOps.deleteLesson(lessonId);

          // Renumber remaining real lessons to close the gap
          const sectionLessons = yield* lessonSectionOps.getLessonsBySectionId(
            lesson.sectionId
          );
          const remainingReal = sectionLessons.filter(
            (l) => l.fsStatus !== "ghost"
          );

          if (remainingReal.length > 0) {
            const renames: { id: string; oldPath: string; newPath: string }[] =
              [];
            for (let i = 0; i < remainingReal.length; i++) {
              const l = remainingReal[i]!;
              const lPath = derivedPaths.get(l.id)!;
              const p = parseLessonPath(lPath);
              if (!p) continue;
              const newPath = buildLessonPath(sectionNumber, i + 1, p.slug);
              if (newPath !== lPath) {
                renames.push({ id: l.id, oldPath: lPath, newPath });
              }
            }

            if (renames.length > 0) {
              yield* repoWrite.renameLessons({
                repoPath,
                sectionPath,
                renames: renames.map((r) => ({
                  oldPath: r.oldPath,
                  newPath: r.newPath,
                })),
              });

              for (const rename of renames) {
                yield* lessonSectionOps.updateLesson(rename.id, {
                  path: rename.newPath,
                });
              }
            }
          }

          // If no real lessons remain, remove the section directory,
          // revert the section path to title case, and renumber other sections
          if (remainingReal.length === 0) {
            const sectionParsed = parseSectionPath(sectionPath);
            if (sectionParsed) {
              yield* repoWrite.deleteSectionDir({ repoPath, sectionPath });
              const title = titleCaseFromSlug(sectionParsed.slug);
              yield* lessonSectionOps.updateSectionPath(
                lesson.sectionId,
                title
              );
              yield* renumberSections(lesson.section.repoVersionId, repoPath);
            }
          }
          yield* runValidation(repoPath);
        } else {
          // Ghost lesson: DB-only delete, skip filesystem validation
          yield* lessonSectionOps.deleteLesson(lessonId);
        }

        return { success: true };
      });

      const convertToGhost = Effect.fn("convertToGhost")(function* (
        lessonId: string
      ) {
        const lesson =
          yield* lessonSectionOps.getLessonWithHierarchyById(lessonId);

        if (lesson.fsStatus !== "real") {
          return yield* new CourseWriteError({
            cause: null,
            message: "Lesson is already a ghost",
          });
        }

        const repoPath = lesson.section.repoVersion.repo.filePath!;
        const versionTree =
          yield* lessonSectionOps.getSectionsWithLessonsByRepoVersionId(
            lesson.section.repoVersionId
          );
        const derivedPaths = projectVersionPaths(versionTree);
        const sectionPath = derivedPaths.get(lesson.sectionId)!;
        const parsed = parseSectionPath(sectionPath);
        const sectionNumber = parsed?.sectionNumber ?? 1;

        yield* runValidation(repoPath);

        // Delete the lesson directory from disk
        yield* repoWrite.deleteLesson({
          repoPath,
          sectionPath,
          lessonDirName: derivedPaths.get(lessonId)!,
        });

        // Mark lesson as ghost in DB
        yield* lessonSectionOps.updateLesson(lessonId, {
          fsStatus: "ghost",
          authoringStatus: statusForConvertToGhost(),
        });

        // Renumber remaining real lessons to close the gap
        const sectionLessons = yield* lessonSectionOps.getLessonsBySectionId(
          lesson.sectionId
        );
        const remainingReal = sectionLessons.filter(
          (l) => l.fsStatus !== "ghost" && l.id !== lessonId
        );

        if (remainingReal.length > 0) {
          const renames: { id: string; oldPath: string; newPath: string }[] =
            [];
          for (let i = 0; i < remainingReal.length; i++) {
            const l = remainingReal[i]!;
            const lPath = derivedPaths.get(l.id)!;
            const p = parseLessonPath(lPath);
            if (!p) continue;
            const newPath = buildLessonPath(sectionNumber, i + 1, p.slug);
            if (newPath !== lPath) {
              renames.push({ id: l.id, oldPath: lPath, newPath });
            }
          }

          if (renames.length > 0) {
            yield* repoWrite.renameLessons({
              repoPath,
              sectionPath,
              renames: renames.map((r) => ({
                oldPath: r.oldPath,
                newPath: r.newPath,
              })),
            });

            for (const rename of renames) {
              yield* lessonSectionOps.updateLesson(rename.id, {
                path: rename.newPath,
              });
            }
          }
        }

        // If no real lessons remain, remove the section directory,
        // revert the section path to title case, and renumber other sections
        if (remainingReal.length === 0) {
          const sectionParsed = parseSectionPath(sectionPath);
          if (sectionParsed) {
            yield* repoWrite.deleteSectionDir({ repoPath, sectionPath });
            const title = titleCaseFromSlug(sectionParsed.slug);
            yield* lessonSectionOps.updateSectionPath(lesson.sectionId, title);
            yield* renumberSections(lesson.section.repoVersionId, repoPath);
          }
        }

        yield* runValidation(repoPath);

        return { success: true };
      });

      const renameLesson = Effect.fn("renameLesson")(function* (
        lessonId: string,
        newSlug: string
      ) {
        const lesson =
          yield* lessonSectionOps.getLessonWithHierarchyById(lessonId);

        const versionTree =
          yield* lessonSectionOps.getSectionsWithLessonsByRepoVersionId(
            lesson.section.repoVersionId
          );
        const derivedPaths = projectVersionPaths(versionTree);
        const lessonPath =
          derivedPaths.get(lessonId) ?? (toSlug(lesson.title) || "untitled");

        const oldParsed = parseLessonPath(lessonPath);

        // Ghost lesson with unparseable path — just update the slug in DB
        if (!oldParsed) {
          if (lessonPath === newSlug) {
            return { success: true, path: lessonPath };
          }
          yield* lessonSectionOps.updateLesson(lessonId, { path: newSlug });
          return { success: true, path: newSlug };
        }

        if (oldParsed.slug === newSlug) {
          return { success: true, path: lessonPath };
        }

        const sectionPath = derivedPaths.get(lesson.sectionId);
        const sectionNumber =
          oldParsed.sectionNumber ??
          parseSectionPath(sectionPath ?? "")?.sectionNumber ??
          1;
        const newPath = buildLessonPath(
          sectionNumber,
          oldParsed.lessonNumber,
          newSlug
        );

        if (lesson.fsStatus !== "ghost") {
          const repoPath = lesson.section.repoVersion.repo.filePath!;

          yield* runValidation(repoPath);

          yield* repoWrite.renameLesson({
            repoPath,
            sectionPath: sectionPath!,
            oldLessonDirName: lessonPath,
            newSlug,
          });
        }

        yield* lessonSectionOps.updateLesson(lessonId, {
          path: newPath,
        });

        if (lesson.fsStatus !== "ghost") {
          yield* runValidation(lesson.section.repoVersion.repo.filePath);
        }

        return { success: true, path: newPath };
      });

      const reorderLessons = Effect.fn("reorderLessons")(function* (
        sectionId: string,
        newOrderIds: readonly string[]
      ) {
        const section =
          yield* lessonSectionOps.getSectionWithHierarchyById(sectionId);
        const repoPath = section.repoVersion.repo.filePath!;
        const versionTree =
          yield* lessonSectionOps.getSectionsWithLessonsByRepoVersionId(
            section.repoVersionId
          );
        const derivedPaths = projectVersionPaths(versionTree);
        const sectionPath = derivedPaths.get(sectionId)!;

        const sectionLessons =
          yield* lessonSectionOps.getLessonsBySectionId(sectionId);

        // Only real lessons participate in filesystem renaming
        const realLessons = sectionLessons.filter(
          (l) => l.fsStatus !== "ghost"
        );
        const realLessonIds = newOrderIds.filter((id) =>
          realLessons.some((l) => l.id === id)
        );
        const lessonsForReorder = realLessons.map((l) => ({
          id: l.id,
          path: derivedPaths.get(l.id)!,
        }));
        const renames = computeRenumberingPlan(
          lessonsForReorder,
          realLessonIds
        );

        if (renames.length > 0) {
          yield* repoWrite.renameLessons({
            repoPath,
            sectionPath,
            renames: renames.map((r) => ({
              oldPath: r.oldPath,
              newPath: r.newPath,
            })),
          });

          for (const rename of renames) {
            const parsed = parseLessonPath(rename.newPath);
            if (parsed) {
              yield* lessonSectionOps.updateLesson(rename.id, {
                path: rename.newPath,
                lessonNumber: parsed.lessonNumber,
              });
            }
          }
        }

        // Update order for ALL lessons (ghost + real) in a single query
        yield* lessonSectionOps.batchUpdateLessonOrders(
          newOrderIds.map((id, i) => ({ id, order: i }))
        );

        return { success: true, renames };
      });

      const { moveToSection, moveLessonsToSection } = createMoveOps(
        lessonSectionOps,
        repoWrite,
        fileSystem,
        runValidation
      );

      const archiveSection = Effect.fn("archiveSection")(function* (
        sectionId: string
      ) {
        const sectionLessons =
          yield* lessonSectionOps.getLessonsBySectionId(sectionId);
        const realLessons = sectionLessons.filter(
          (l) => l.fsStatus !== "ghost"
        );

        if (realLessons.length > 0) {
          return yield* new CourseWriteError({
            cause: null,
            message:
              "Cannot archive section with real lessons. Convert or delete them first.",
          });
        }

        yield* lessonSectionOps.archiveSection(sectionId);
        return { success: true };
      });

      return {
        // Always-FS operations: pre-flight gate + post-write validation
        materializeGhost: (...args: Parameters<typeof materializeGhost>) =>
          withPreAndPostValidation(
            repoPathForLesson(args[0]),
            materializeGhost(...args)
          ),
        createRealLesson: (...args: Parameters<typeof createRealLesson>) =>
          withPreAndPostValidation(
            repoPathForSection(args[0]),
            createRealLesson(...args)
          ),
        materializeCourseWithLesson: (
          ...args: Parameters<typeof materializeCourseWithLesson>
        ) =>
          withPreAndPostValidation(
            Effect.succeed<string | null>(args[2]),
            materializeCourseWithLesson(...args)
          ),
        reorderLessons: (...args: Parameters<typeof reorderLessons>) =>
          withPreAndPostValidation(
            repoPathForSection(args[0]),
            reorderLessons(...args)
          ),
        reorderSections: (...args: Parameters<typeof reorderSections>) =>
          withPreAndPostValidation(
            args[0][0]
              ? repoPathForSection(args[0][0])
              : Effect.succeed<string | null>(null),
            reorderSections(...args)
          ),
        renameSection: (...args: Parameters<typeof renameSection>) =>
          withPreAndPostValidation(
            repoPathForSection(args[0]),
            renameSection(...args)
          ),
        // DB-only operations: no validation
        archiveSection,
        addGhostSection,
        addGhostLesson,
        // Conditionally-FS operations: pre-flight + post-write internally
        // when the operation touches disk; ghost-only edits pay nothing.
        convertToGhost,
        deleteLesson,
        renameLesson,
        moveToSection,
        moveLessonsToSection,
      };
    }),
    dependencies: [
      LessonSectionOperationsService.Default,
      CourseOperationsService.Default,
      CourseRepoWriteService.Default,
      CourseRepoSyncValidationService.Default,
      NodeFileSystem.layer,
    ],
  }
) {}
