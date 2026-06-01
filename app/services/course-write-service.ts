import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import nodePath from "node:path";
import { CourseOperationsService } from "./db-course-operations.server";
import { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import { CourseRepoWriteService } from "./course-repo-write-service";
import {
  toSlug,
  computeRenumberingPlan,
  parseLessonPath,
  buildLessonPath,
} from "./lesson-path-service";
import {
  parseSectionPath,
  titleFromSlug,
  buildSectionPath,
  sectionHasRealLessons,
  sectionSlugFromPath,
} from "./section-path-service";
import { createSectionOps } from "./course-write-service.helpers";
import { createMaterializeOps } from "./course-write-materialize-ops";
import { CourseWriteError } from "./course-write-service.types";
import { CourseRepoSyncValidationService } from "./course-repo-sync-validation";
import { createValidationHelpers } from "./course-write-validation-helpers";
import { statusForConvertToGhost } from "./lesson-authoring-status";

export { CourseWriteError } from "./course-write-service.types";
export { CourseRepoSyncError } from "./course-repo-sync-validation";

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
        withPostValidation,
        repoPathForSection,
        repoPathForLesson,
      } = createValidationHelpers(lessonSectionOps, syncService);

      const { renumberSections, reorderSections, renameSection } =
        createSectionOps(lessonSectionOps, repoWrite);

      const addGhostSection = Effect.fn("addGhostSection")(function* (
        repoVersionId: string,
        title: string,
        maxOrder: number = 0
      ) {
        const sectionNumber = maxOrder + 1;
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
          const sectionPath = lesson.section.path;
          const parsed = parseSectionPath(sectionPath);
          const sectionNumber = parsed?.sectionNumber ?? 1;

          yield* repoWrite.deleteLesson({
            repoPath,
            sectionPath,
            lessonDirName: lesson.path,
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
              const p = parseLessonPath(l.path);
              if (!p) continue;
              const newPath = buildLessonPath(sectionNumber, i + 1, p.slug);
              if (newPath !== l.path) {
                renames.push({ id: l.id, oldPath: l.path, newPath });
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
              const title = titleFromSlug(sectionParsed.slug);
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
        const sectionPath = lesson.section.path;
        const parsed = parseSectionPath(sectionPath);
        const sectionNumber = parsed?.sectionNumber ?? 1;

        // Delete the lesson directory from disk
        yield* repoWrite.deleteLesson({
          repoPath,
          sectionPath,
          lessonDirName: lesson.path,
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
            const p = parseLessonPath(l.path);
            if (!p) continue;
            const newPath = buildLessonPath(sectionNumber, i + 1, p.slug);
            if (newPath !== l.path) {
              renames.push({ id: l.id, oldPath: l.path, newPath });
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
            const title = titleFromSlug(sectionParsed.slug);
            yield* lessonSectionOps.updateSectionPath(lesson.sectionId, title);
            yield* renumberSections(lesson.section.repoVersionId, repoPath);
          }
        }

        return { success: true };
      });

      const renameLesson = Effect.fn("renameLesson")(function* (
        lessonId: string,
        newSlug: string
      ) {
        const lesson =
          yield* lessonSectionOps.getLessonWithHierarchyById(lessonId);

        const oldParsed = parseLessonPath(lesson.path);

        // Ghost lesson with unparseable path — just update the slug in DB
        if (!oldParsed) {
          if (lesson.path === newSlug) {
            return { success: true, path: lesson.path };
          }
          yield* lessonSectionOps.updateLesson(lessonId, { path: newSlug });
          return { success: true, path: newSlug };
        }

        if (oldParsed.slug === newSlug) {
          return { success: true, path: lesson.path };
        }

        const sectionNumber =
          oldParsed.sectionNumber ??
          parseSectionPath(lesson.section.path)?.sectionNumber ??
          1;
        const newPath = buildLessonPath(
          sectionNumber,
          oldParsed.lessonNumber,
          newSlug
        );

        if (lesson.fsStatus !== "ghost") {
          const repoPath = lesson.section.repoVersion.repo.filePath!;
          const sectionPath = lesson.section.path;

          yield* repoWrite.renameLesson({
            repoPath,
            sectionPath,
            oldLessonDirName: lesson.path,
            newSlug,
          });
        }

        yield* lessonSectionOps.updateLesson(lessonId, {
          path: newPath,
        });

        // Only validate after filesystem-modifying renames
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
        const sectionPath = section.path;

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
          path: l.path,
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

      const moveToSection = Effect.fn("moveToSection")(function* (
        lessonId: string,
        targetSectionId: string
      ) {
        const lesson =
          yield* lessonSectionOps.getLessonWithHierarchyById(lessonId);
        const targetLessons =
          yield* lessonSectionOps.getLessonsBySectionId(targetSectionId);
        const maxOrder =
          targetLessons.length > 0
            ? Math.max(...targetLessons.map((l) => l.order))
            : 0;

        // Ghost lesson: DB-only move — skip filesystem validation entirely
        if (lesson.fsStatus === "ghost") {
          yield* lessonSectionOps.updateLesson(lessonId, {
            sectionId: targetSectionId,
          });
          yield* lessonSectionOps.updateLessonOrder(lessonId, maxOrder + 1);
          return { success: true };
        }

        // Real lesson: filesystem move + renumber both sections
        const repoPath = lesson.section.repoVersion.repo.filePath!;
        const sourceSectionPath = lesson.section.path;
        const repoVersionId = lesson.section.repoVersionId;
        const targetSection =
          yield* lessonSectionOps.getSectionWithHierarchyById(targetSectionId);
        let targetSectionPath = targetSection.path;

        const sourceParsed = parseSectionPath(sourceSectionPath);
        const sourceSectionNumber = sourceParsed?.sectionNumber ?? 1;

        // Real-ness comes from real lessons, never the path prefix (a ghost
        // can carry a numbered path with no dir). Materialize a ghost target.
        const targetIsGhost = !sectionHasRealLessons(targetLessons);
        let targetSectionMaterialized = false;
        if (targetIsGhost) {
          const allSections =
            yield* lessonSectionOps.getSectionsWithLessonsByRepoVersionId(
              repoVersionId
            );
          const posIdx = allSections.findIndex((s) => s.id === targetSectionId);
          let realBefore = 0;
          for (let i = 0; i < posIdx; i++) {
            if (sectionHasRealLessons(allSections[i]!.lessons)) realBefore++;
          }
          const sectionNumber = realBefore + 1;
          const sectionSlug = sectionSlugFromPath(targetSectionPath);
          targetSectionPath = buildSectionPath(sectionNumber, sectionSlug);
          yield* lessonSectionOps.updateSectionPath(
            targetSectionId,
            targetSectionPath
          );
          yield* fileSystem.makeDirectory(
            nodePath.join(repoPath, targetSectionPath),
            { recursive: true }
          );
          targetSectionMaterialized = true;
        }
        const targetSectionNumber =
          parseSectionPath(targetSectionPath)?.sectionNumber ?? 1;

        const lessonParsed = parseLessonPath(lesson.path);
        const slug = lessonParsed?.slug ?? lesson.path;
        const targetRealLessons = targetLessons.filter(
          (l) => l.fsStatus !== "ghost"
        );
        const nextLessonNumber = targetRealLessons.length + 1;
        const newLessonPath = buildLessonPath(
          targetSectionNumber,
          nextLessonNumber,
          slug
        );

        yield* repoWrite.moveLessonToSection({
          repoPath,
          sourceSectionPath,
          targetSectionPath,
          oldLessonDirName: lesson.path,
          newLessonDirName: newLessonPath,
        });

        yield* lessonSectionOps.updateLesson(lessonId, {
          sectionId: targetSectionId,
          path: newLessonPath,
        });
        yield* lessonSectionOps.updateLessonOrder(lessonId, maxOrder + 1);

        // Renumber source section real lessons to close the gap
        const sourceLessons = yield* lessonSectionOps.getLessonsBySectionId(
          lesson.sectionId
        );
        const sourceRealLessons = sourceLessons.filter(
          (l) => l.fsStatus !== "ghost" && l.id !== lessonId
        );

        if (sourceRealLessons.length > 0) {
          const renames: { id: string; oldPath: string; newPath: string }[] =
            [];
          for (let i = 0; i < sourceRealLessons.length; i++) {
            const l = sourceRealLessons[i]!;
            const p = parseLessonPath(l.path);
            if (!p) continue;
            const newPath = buildLessonPath(sourceSectionNumber, i + 1, p.slug);
            if (newPath !== l.path) {
              renames.push({ id: l.id, oldPath: l.path, newPath });
            }
          }

          if (renames.length > 0) {
            yield* repoWrite.renameLessons({
              repoPath,
              sectionPath: sourceSectionPath,
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

        // If no real lessons remain in source, revert it to ghost
        if (sourceRealLessons.length === 0 && sourceParsed) {
          yield* repoWrite.deleteSectionDir({
            repoPath,
            sectionPath: sourceSectionPath,
          });
          const title = titleFromSlug(sourceParsed.slug);
          yield* lessonSectionOps.updateSectionPath(lesson.sectionId, title);
        }

        // Renumber sections if any were materialized or dematerialized
        if (
          targetSectionMaterialized ||
          (sourceRealLessons.length === 0 && sourceParsed)
        ) {
          yield* renumberSections(repoVersionId, repoPath);
        }

        yield* runValidation(repoPath);
        return { success: true };
      });

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
        // Always-FS operations: validate after, scoped to the touched repo
        materializeGhost: (...args: Parameters<typeof materializeGhost>) =>
          withPostValidation(
            repoPathForLesson(args[0]),
            materializeGhost(...args)
          ),
        createRealLesson: (...args: Parameters<typeof createRealLesson>) =>
          withPostValidation(
            repoPathForSection(args[0]),
            createRealLesson(...args)
          ),
        materializeCourseWithLesson: (
          ...args: Parameters<typeof materializeCourseWithLesson>
        ) =>
          withPostValidation(
            Effect.succeed<string | null>(args[2]),
            materializeCourseWithLesson(...args)
          ),
        convertToGhost: (...args: Parameters<typeof convertToGhost>) =>
          withPostValidation(
            repoPathForLesson(args[0]),
            convertToGhost(...args)
          ),
        reorderLessons: (...args: Parameters<typeof reorderLessons>) =>
          withPostValidation(
            repoPathForSection(args[0]),
            reorderLessons(...args)
          ),
        reorderSections: (...args: Parameters<typeof reorderSections>) =>
          withPostValidation(
            args[0][0]
              ? repoPathForSection(args[0][0])
              : Effect.succeed<string | null>(null),
            reorderSections(...args)
          ),
        renameSection: (...args: Parameters<typeof renameSection>) =>
          withPostValidation(
            repoPathForSection(args[0]),
            renameSection(...args)
          ),
        // DB-only operations: no validation
        archiveSection,
        addGhostSection,
        addGhostLesson,
        // Conditionally-FS operations: validate internally only when FS is touched
        deleteLesson,
        renameLesson,
        moveToSection,
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
