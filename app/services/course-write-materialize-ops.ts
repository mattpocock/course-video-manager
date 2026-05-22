import { Effect } from "effect";
import type { FileSystem } from "@effect/platform";
import nodePath from "node:path";
import type { CourseOperationsService } from "./db-course-operations.server";
import type { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import type { CourseRepoWriteService } from "./course-repo-write-service";
import {
  toSlug,
  computeInsertionPlan,
  parseLessonPath,
} from "./lesson-path-service";
import { parseSectionPath, buildSectionPath } from "./section-path-service";
import { validateAndAssignRepoPath } from "./course-write-service.helpers";
import { CourseWriteError } from "./course-write-service.types";
import {
  statusForCreateLesson,
  statusForMaterialize,
} from "./lesson-authoring-status";

export function createMaterializeOps<E1>(
  lessonSectionOps: LessonSectionOperationsService,
  db: Pick<CourseOperationsService, "updateCourseFilePath">,
  repoWrite: CourseRepoWriteService,
  fileSystem: FileSystem.FileSystem,
  renumberSections: (
    repoVersionId: string,
    repoPath: string
  ) => Effect.Effect<void, E1>
) {
  /** Creates a real lesson on disk + DB in one step (no ghost intermediate). */
  const createRealLesson = Effect.fn("createRealLesson")(function* (
    sectionId: string,
    title: string,
    opts?: { adjacentLessonId?: string; position?: "before" | "after" }
  ) {
    const section =
      yield* lessonSectionOps.getSectionWithHierarchyById(sectionId);
    const repoPath = section.repoVersion.repo.filePath;

    if (!repoPath) {
      return yield* new CourseWriteError({
        cause: null,
        message: "Cannot create a real lesson in a ghost course",
      });
    }

    let sectionPath = section.path;
    const parsed = parseSectionPath(sectionPath);
    const slug = toSlug(title) || "untitled";
    const repoVersionId = section.repoVersionId;

    // If section is ghost, materialize it
    let sectionMaterialized = false;
    let sectionNumber: number;
    if (!parsed) {
      const allSections =
        yield* lessonSectionOps.getSectionsByRepoVersionId(repoVersionId);
      const positionIndex = allSections.findIndex((s) => s.id === sectionId);
      let realBefore = 0;
      for (let i = 0; i < positionIndex; i++) {
        if (parseSectionPath(allSections[i]!.path)) realBefore++;
      }
      sectionNumber = realBefore + 1;

      const sectionSlug = toSlug(sectionPath) || "untitled";
      sectionPath = buildSectionPath(sectionNumber, sectionSlug);
      yield* lessonSectionOps.updateSectionPath(sectionId, sectionPath);
      sectionMaterialized = true;
    } else {
      sectionNumber = parsed.sectionNumber;
    }

    // Get all lessons in section
    const lessons = yield* lessonSectionOps.getLessonsBySectionId(sectionId);
    const maxOrder =
      lessons.length > 0 ? Math.max(...lessons.map((l) => l.order)) : 0;
    let insertOrder = maxOrder + 1;

    const realLessons = lessons.filter((l) => l.fsStatus !== "ghost");
    let insertAtIndex = realLessons.length;

    if (opts?.adjacentLessonId && opts?.position) {
      const adjLesson = lessons.find((l) => l.id === opts.adjacentLessonId);
      if (adjLesson) {
        const adjOrder = adjLesson.order;

        // Determine insert position among real lessons
        for (let i = 0; i < realLessons.length; i++) {
          if (
            opts.position === "before"
              ? realLessons[i]!.order >= adjOrder
              : realLessons[i]!.order > adjOrder
          ) {
            insertAtIndex = i;
            break;
          }
          if (i === realLessons.length - 1) {
            insertAtIndex = realLessons.length;
          }
        }

        // Shift orders for subsequent lessons
        const adjIdx = lessons.findIndex((l) => l.id === opts.adjacentLessonId);
        if (adjIdx !== -1) {
          const idx = opts.position === "after" ? adjIdx + 1 : adjIdx;
          const shiftUpdates = lessons
            .slice(idx)
            .map((l) => ({ id: l.id, order: l.order + 1 }));
          yield* lessonSectionOps.batchUpdateLessonOrders(shiftUpdates);
          insertOrder = lessons[idx] ? lessons[idx]!.order : maxOrder + 1;
        }
      }
    }

    const existingRealLessons = realLessons.map((l) => ({
      id: l.id,
      path: l.path,
    }));

    const plan = computeInsertionPlan({
      existingRealLessons,
      insertAtIndex,
      sectionNumber,
      slug,
    });

    // Rename shifted lessons on disk
    if (plan.renames.length > 0) {
      yield* repoWrite.renameLessons({
        repoPath,
        sectionPath,
        renames: plan.renames.map((r) => ({
          oldPath: r.oldPath,
          newPath: r.newPath,
        })),
      });

      for (const rename of plan.renames) {
        yield* lessonSectionOps.updateLesson(rename.id, {
          path: rename.newPath,
        });
      }
    }

    // Create directory on disk
    yield* repoWrite.createLessonDirectory({
      repoPath,
      sectionPath,
      lessonDirName: plan.newLessonDirName,
    });

    // Create DB entry as ghost, then update to real
    const [newLesson] = yield* lessonSectionOps.createGhostLesson(sectionId, {
      title,
      path: plan.newLessonDirName,
      order: insertOrder,
    });

    yield* lessonSectionOps.updateLesson(newLesson!.id, {
      fsStatus: "real",
      authoringStatus: statusForCreateLesson("real"),
    });

    // Renumber sections if we materialized one
    if (sectionMaterialized) {
      yield* renumberSections(repoVersionId, repoPath);
    }

    return {
      success: true,
      lessonId: newLesson!.id,
      path: plan.newLessonDirName,
    };
  });

  /** Materializes a ghost lesson to disk. */
  const materializeGhost = Effect.fn("materializeGhost")(function* (
    lessonId: string,
    opts?: { repoPath?: string }
  ) {
    const lesson = yield* lessonSectionOps.getLessonWithHierarchyById(lessonId);

    if (lesson.fsStatus !== "ghost") {
      return yield* new CourseWriteError({
        cause: null,
        message: "Lesson is already on disk",
      });
    }

    let repoPath = lesson.section.repoVersion.repo.filePath;

    // If the course is a ghost (no filePath), we need a repoPath to materialize it
    if (!repoPath) {
      if (!opts?.repoPath) {
        return yield* new CourseWriteError({
          cause: null,
          message:
            "Course has no file path — provide a repo path to materialize",
        });
      }

      yield* validateAndAssignRepoPath(
        fileSystem,
        db,
        lesson.section.repoVersion.repo.id,
        opts.repoPath
      );
      repoPath = opts.repoPath;
    }
    const repoVersionId = lesson.section.repoVersionId;
    let sectionPath = lesson.section.path;
    const parsed = parseSectionPath(sectionPath);
    const slug =
      toSlug(lesson.title || "") || toSlug(lesson.path) || "untitled";

    let sectionMaterialized = false;
    let sectionNumber: number;
    if (!parsed) {
      const allSections =
        yield* lessonSectionOps.getSectionsByRepoVersionId(repoVersionId);
      const positionIndex = allSections.findIndex(
        (s) => s.id === lesson.sectionId
      );
      let realBefore = 0;
      for (let i = 0; i < positionIndex; i++) {
        if (parseSectionPath(allSections[i]!.path)) realBefore++;
      }
      sectionNumber = realBefore + 1;

      const sectionSlug = toSlug(sectionPath) || "untitled";
      sectionPath = buildSectionPath(sectionNumber, sectionSlug);
      yield* lessonSectionOps.updateSectionPath(lesson.sectionId, sectionPath);
      sectionMaterialized = true;
    } else {
      sectionNumber = parsed.sectionNumber;
    }

    const sectionLessons = yield* lessonSectionOps.getLessonsBySectionId(
      lesson.sectionId
    );
    const ghostOrder = lesson.order;

    const realLessons = sectionLessons.filter((l) => l.fsStatus !== "ghost");
    let insertAtIndex = realLessons.length;
    for (let i = 0; i < realLessons.length; i++) {
      if (realLessons[i]!.order > ghostOrder) {
        insertAtIndex = i;
        break;
      }
    }

    const existingRealLessons = realLessons.map((l) => ({
      id: l.id,
      path: l.path,
    }));

    const plan = computeInsertionPlan({
      existingRealLessons,
      insertAtIndex,
      sectionNumber,
      slug,
    });

    if (plan.renames.length > 0) {
      yield* repoWrite.renameLessons({
        repoPath,
        sectionPath,
        renames: plan.renames.map((r) => ({
          oldPath: r.oldPath,
          newPath: r.newPath,
        })),
      });

      for (const rename of plan.renames) {
        const renamedParsed = parseLessonPath(rename.newPath);
        if (renamedParsed) {
          yield* lessonSectionOps.updateLesson(rename.id, {
            path: rename.newPath,
          });
        }
      }
    }

    yield* repoWrite.createLessonDirectory({
      repoPath,
      sectionPath,
      lessonDirName: plan.newLessonDirName,
    });

    yield* lessonSectionOps.updateLesson(lessonId, {
      fsStatus: "real",
      path: plan.newLessonDirName,
      sectionId: lesson.sectionId,
      authoringStatus: statusForMaterialize(),
    });

    if (sectionMaterialized) {
      yield* renumberSections(repoVersionId, repoPath);
    }

    return {
      success: true,
      path: plan.newLessonDirName,
      ...(sectionMaterialized && {
        sectionId: lesson.sectionId,
        sectionPath: sectionPath,
      }),
      ...(opts?.repoPath && { courseFilePath: opts.repoPath }),
    };
  });

  /** Materialization Cascade: assigns filePath to a ghost course, then creates a real lesson. */
  const materializeCourseWithLesson = Effect.fn("materializeCourseWithLesson")(
    function* (
      sectionId: string,
      title: string,
      filePath: string,
      opts?: { adjacentLessonId?: string; position?: "before" | "after" }
    ) {
      const section =
        yield* lessonSectionOps.getSectionWithHierarchyById(sectionId);
      const courseId = section.repoVersion.repo.id;
      const originalSectionPath = section.path;

      if (section.repoVersion.repo.filePath) {
        return yield* new CourseWriteError({
          cause: null,
          message:
            "Course already has a file path — use createRealLesson instead",
        });
      }

      yield* validateAndAssignRepoPath(fileSystem, db, courseId, filePath);

      const entriesBefore = yield* fileSystem
        .readDirectory(filePath)
        .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));

      return yield* createRealLesson(sectionId, title, opts).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* db.updateCourseFilePath({
              repoId: courseId,
              filePath: null,
            });
            yield* lessonSectionOps.updateSectionPath(
              sectionId,
              originalSectionPath
            );
            const entriesAfter = yield* fileSystem
              .readDirectory(filePath)
              .pipe(Effect.catchAll(() => Effect.succeed([] as string[])));
            const beforeSet = new Set(entriesBefore);
            for (const entry of entriesAfter) {
              if (!beforeSet.has(entry)) {
                yield* fileSystem
                  .remove(nodePath.join(filePath, entry), { recursive: true })
                  .pipe(Effect.catchAll(() => Effect.void));
              }
            }
            return yield* Effect.fail(error);
          })
        )
      );
    }
  );

  return { createRealLesson, materializeGhost, materializeCourseWithLesson };
}
