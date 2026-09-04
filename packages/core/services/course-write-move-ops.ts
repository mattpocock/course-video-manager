import { Effect } from "effect";
import type { LessonSectionOperationsService } from "./db-lesson-section-operations.server.js";
import {
  planLessonMove,
  planLessonsMove,
  type LessonMovePlan,
} from "./lesson-move-planner.js";

type DbSection = {
  id: string;
  lessons: {
    id: string;
    order: number;
  }[];
};

const toPlannerSections = (dbSections: DbSection[]) =>
  dbSections.map((s) => ({
    id: s.id,
    lessons: s.lessons.map((l) => ({ id: l.id, order: l.order })),
  }));

export function createMoveOps(db: LessonSectionOperationsService) {
  const executeMovePlan = Effect.fn("executeMovePlan")(function* (
    plan: LessonMovePlan
  ) {
    if (plan.noop) return { success: true } as const;

    for (let i = 0; i < plan.lessonUpdates.length; i++) {
      const u = plan.lessonUpdates[i]!;
      yield* db.updateLesson(u.id, {
        sectionId: u.sectionId,
        lessonNumber: -(i + 1) * 100000,
      });
    }
    yield* db.batchUpdateLessonOrders(
      plan.lessonUpdates.map((u) => ({ id: u.id, order: u.order }))
    );

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
