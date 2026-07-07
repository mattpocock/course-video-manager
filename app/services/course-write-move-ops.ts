import { Effect } from "effect";
import type { FileSystem } from "@effect/platform";
import nodePath from "node:path";
import type { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import type { CourseRepoWriteService } from "./course-repo-write-service";
import {
  planLessonMove,
  planLessonsMove,
  type LessonMovePlan,
} from "./lesson-move-planner";
import { CourseWriteError } from "./course-write-service.types";
import type { CourseRepoSyncError } from "./course-repo-sync-validation";
import { projectVersionPaths } from "./path-projection";
import { toSlug } from "./lesson-path-service";

type DbSection = {
  id: string;
  title: string;
  order: number;
  path: string;
  lessons: {
    id: string;
    title: string;
    path: string;
    order: number;
    fsStatus: string | null;
  }[];
};

/**
 * Feed the pure move planner compute-on-read paths: real sections/lessons get
 * their derived "NN(.MM)-slug" folder name from (title, rank); ghosts (no
 * derived path) fall back to a title-derived name, never the stored column.
 */
const toPlannerSections = (dbSections: DbSection[]) => {
  const derived = projectVersionPaths(dbSections);
  return dbSections.map((s) => ({
    id: s.id,
    path: derived.get(s.id) ?? s.title,
    lessons: s.lessons.map((l) => ({
      id: l.id,
      path: derived.get(l.id) ?? (toSlug(l.title) || "untitled"),
      order: l.order,
      fsStatus: l.fsStatus,
    })),
  }));
};

/**
 * Lesson-move operations: a single cross-section move (`moveToSection`) and a
 * bulk multi-select move (`moveLessonsToSection`). Both compute the cascade
 * purely via the move planners (ADR 0011 / ADR 0013) so the client optimistic
 * applier can replay the identical algorithm, then run the resulting plan
 * through one shared executor.
 */
export function createMoveOps(
  db: LessonSectionOperationsService,
  repoWrite: CourseRepoWriteService,
  fileSystem: FileSystem.FileSystem,
  runValidation: (
    repoPath: string
  ) => Effect.Effect<unknown, CourseRepoSyncError>
) {
  // Pre-flight repo-sync gate (#966) before touching the filesystem, then run
  // the plan's fsOps in order (each references paths as they exist at that
  // step), apply its DB deltas, and validate again when the filesystem was
  // touched. Real moves need a repo path.
  const executeMovePlan = Effect.fn("executeMovePlan")(function* (
    plan: LessonMovePlan,
    repoPath: string | null
  ) {
    if (plan.noop) return { success: true } as const;

    if (plan.fsOps.length > 0) {
      if (!repoPath) {
        return yield* new CourseWriteError({
          cause: null,
          message: "Cannot move a real lesson in a course with no path",
        });
      }
      yield* runValidation(repoPath);
      for (const op of plan.fsOps) {
        switch (op.kind) {
          case "makeSectionDir":
            yield* fileSystem.makeDirectory(
              nodePath.join(repoPath, op.sectionPath),
              { recursive: true }
            );
            break;
          case "deleteSectionDir":
            yield* repoWrite.deleteSectionDir({
              repoPath,
              sectionPath: op.sectionPath,
            });
            break;
          case "moveLesson":
            yield* repoWrite.moveLessonToSection({
              repoPath,
              sourceSectionPath: op.sourceSectionPath,
              targetSectionPath: op.targetSectionPath,
              oldLessonDirName: op.oldLessonDirName,
              newLessonDirName: op.newLessonDirName,
            });
            break;
          case "renameLessons":
            yield* repoWrite.renameLessons({
              repoPath,
              sectionPath: op.sectionPath,
              renames: op.renames,
            });
            break;
          case "renameSections":
            yield* repoWrite.renameSections({
              repoPath,
              renames: op.renames,
            });
            break;
        }
      }
    }

    for (const u of plan.lessonUpdates) {
      yield* db.updateLesson(u.id, { sectionId: u.sectionId, path: u.path });
      yield* db.updateLessonOrder(u.id, u.order);
    }
    for (const u of plan.sectionUpdates) {
      yield* db.updateSectionPath(u.id, u.path);
    }

    if (plan.fsOps.length > 0 && repoPath) {
      yield* runValidation(repoPath);
    }

    return { success: true } as const;
  });

  const moveToSection = Effect.fn("moveToSection")(function* (
    lessonId: string,
    targetSectionId: string,
    beforeLessonId: string | null = null
  ) {
    const lesson = yield* db.getLessonWithHierarchyById(lessonId);
    const repoPath = lesson.section.repoVersion.repo.filePath;

    const dbSections = yield* db.getSectionsWithLessonsByRepoVersionId(
      lesson.section.repoVersionId
    );
    const plan = planLessonMove({
      sections: toPlannerSections(dbSections),
      lessonId,
      targetSectionId,
      beforeLessonId,
    });

    return yield* executeMovePlan(plan, repoPath);
  });

  const moveLessonsToSection = Effect.fn("moveLessonsToSection")(function* (
    lessonIds: string[],
    targetSectionId: string,
    beforeLessonId: string | null = null
  ) {
    if (lessonIds.length === 0) return { success: true };

    // All selected lessons share a version; derive context from the first.
    const lesson = yield* db.getLessonWithHierarchyById(lessonIds[0]!);
    const repoPath = lesson.section.repoVersion.repo.filePath;

    const dbSections = yield* db.getSectionsWithLessonsByRepoVersionId(
      lesson.section.repoVersionId
    );
    const plan = planLessonsMove({
      sections: toPlannerSections(dbSections),
      lessonIds,
      targetSectionId,
      beforeLessonId,
    });

    return yield* executeMovePlan(plan, repoPath);
  });

  return { moveToSection, moveLessonsToSection };
}
