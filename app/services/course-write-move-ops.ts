import { Effect } from "effect";
import type { LessonSectionOperationsService } from "./db-lesson-section-operations.server";
import {
  planLessonMove,
  planLessonsMove,
  type LessonMovePlan,
} from "./lesson-move-planner";
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

export function createMoveOps(db: LessonSectionOperationsService) {
  const executeMovePlan = Effect.fn("executeMovePlan")(function* (
    plan: LessonMovePlan
  ) {
    if (plan.noop) return { success: true } as const;

    for (const u of plan.lessonUpdates) {
      yield* db.updateLesson(u.id, { sectionId: u.sectionId, path: u.path });
      yield* db.updateLessonOrder(u.id, u.order);
    }
    for (const u of plan.sectionUpdates) {
      yield* db.updateSectionPath(u.id, u.path);
    }

    return { success: true } as const;
  });

  const moveToSection = Effect.fn("moveToSection")(function* (
    lessonId: string,
    targetSectionId: string,
    beforeLessonId: string | null = null
  ) {
    const lesson = yield* db.getLessonWithHierarchyById(lessonId);

    const dbSections = yield* db.getSectionsWithLessonsByRepoVersionId(
      lesson.section.repoVersionId
    );
    const plan = planLessonMove({
      sections: toPlannerSections(dbSections),
      lessonId,
      targetSectionId,
      beforeLessonId,
    });

    return yield* executeMovePlan(plan);
  });

  const moveLessonsToSection = Effect.fn("moveLessonsToSection")(function* (
    lessonIds: string[],
    targetSectionId: string,
    beforeLessonId: string | null = null
  ) {
    if (lessonIds.length === 0) return { success: true };

    const lesson = yield* db.getLessonWithHierarchyById(lessonIds[0]!);

    const dbSections = yield* db.getSectionsWithLessonsByRepoVersionId(
      lesson.section.repoVersionId
    );
    const plan = planLessonsMove({
      sections: toPlannerSections(dbSections),
      lessonIds,
      targetSectionId,
      beforeLessonId,
    });

    return yield* executeMovePlan(plan);
  });

  return { moveToSection, moveLessonsToSection };
}
