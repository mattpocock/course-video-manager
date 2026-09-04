/**
 * Pure planner for moving a Lesson between Sections.
 *
 * Since ADR 0018, a course has no filesystem presence and a section/lesson's
 * display path is derived fresh from its title on every read (see
 * `path-projection.ts`) — never stored, never renamed. Moving a lesson
 * between sections is therefore nothing but an `order`/`sectionId`
 * reassignment for the moved lesson(s): no other lesson's `order` changes
 * (insertion uses a fractional `order` between neighbours, so nothing needs
 * to shift), and no section's title or path is ever touched by a move.
 *
 * This module computes that reassignment as pure data. The server (in
 * `course-write-move-ops.ts`) runs the planner and applies `lessonUpdates`
 * to the database; the client optimistic applier runs the SAME planner and
 * applies the same updates to loader data. One algorithm, two consumers, no
 * drift. See docs/adr/0011-shared-lesson-move-planner.md and
 * docs/adr/0028-drop-numbered-path-prefix.md.
 */

export type PlannerLesson = {
  id: string;
  order: number;
};

export type PlannerSection = {
  id: string;
  /** Lessons in display order (ascending `order`). */
  lessons: PlannerLesson[];
};

export type LessonMoveInput = {
  /** All sections of the version. */
  sections: PlannerSection[];
  lessonId: string;
  targetSectionId: string;
  /**
   * Drop anchor: place the moved lesson immediately before this lesson in the
   * target section. `null` appends to the end of the target.
   */
  beforeLessonId: string | null;
};

export type LessonUpdate = {
  id: string;
  sectionId: string;
  order: number;
};

export type LessonMovePlan = {
  lessonUpdates: LessonUpdate[];
  /** True when the move is a no-op (lesson/target missing, or same section). */
  noop: boolean;
};

const NOOP: LessonMovePlan = {
  lessonUpdates: [],
  noop: true,
};

/** Order value placing the moved lesson at the drop anchor in the target. */
function computeInsertOrder(
  targetLessons: PlannerLesson[],
  beforeLessonId: string | null,
  maxOrder: number
): number {
  if (beforeLessonId === null) return maxOrder + 1;
  const anchor = targetLessons.find((l) => l.id === beforeLessonId);
  if (!anchor) return maxOrder + 1;
  const predecessors = targetLessons.filter((l) => l.order < anchor.order);
  if (predecessors.length === 0) return anchor.order - 1;
  const predOrder = Math.max(...predecessors.map((l) => l.order));
  return (predOrder + anchor.order) / 2;
}

export function planLessonMove(input: LessonMoveInput): LessonMovePlan {
  const { sections, lessonId, targetSectionId, beforeLessonId } = input;

  const sourceSection = sections.find((s) =>
    s.lessons.some((l) => l.id === lessonId)
  );
  const targetSection = sections.find((s) => s.id === targetSectionId);
  if (!sourceSection || !targetSection) return NOOP;
  if (sourceSection.id === targetSectionId) return NOOP;

  const targetLessons = targetSection.lessons;
  const maxOrder =
    targetLessons.length > 0
      ? Math.max(...targetLessons.map((l) => l.order))
      : 0;
  const newOrder = computeInsertOrder(targetLessons, beforeLessonId, maxOrder);

  return {
    lessonUpdates: [
      { id: lessonId, sectionId: targetSectionId, order: newOrder },
    ],
    noop: false,
  };
}

export type LessonsMoveInput = {
  /** All sections of the version. */
  sections: PlannerSection[];
  /**
   * Lessons to move, in the order they should land in the target. The caller
   * passes them in source display order so their relative order is preserved
   * and they land as one contiguous block at the drop anchor.
   */
  lessonIds: string[];
  targetSectionId: string;
  /** Drop anchor in the target; `null` appends. Never one of `lessonIds`. */
  beforeLessonId: string | null;
};

/**
 * Plan a bulk cross-section move by folding {@link planLessonMove} over the
 * selected lessons one at a time, threading the post-move model into the next
 * step. Anchoring every lesson at the same `beforeLessonId` and iterating in
 * target order leaves them contiguous and in order just before the anchor.
 * See docs/adr/0012-bulk-lesson-reorder-within-section.md and
 * docs/adr/0013-cross-section-bulk-lesson-move.md.
 */
export function planLessonsMove(input: LessonsMoveInput): LessonMovePlan {
  const { lessonIds, targetSectionId, beforeLessonId } = input;

  let model: PlannerSection[] = input.sections;
  const lessonUpdates: LessonUpdate[] = [];
  let moved = false;

  for (const lessonId of lessonIds) {
    const step = planLessonMove({
      sections: model,
      lessonId,
      targetSectionId,
      beforeLessonId,
    });
    if (step.noop) continue;
    moved = true;
    lessonUpdates.push(...step.lessonUpdates);
    model = applyPlanToModel(model, step);
  }

  if (!moved) return NOOP;

  return { lessonUpdates, noop: false };
}

/**
 * Apply a single plan's data deltas to a planner model, returning the next
 * model (same section order, lessons re-sorted into display order).
 */
function applyPlanToModel(
  sections: PlannerSection[],
  plan: LessonMovePlan
): PlannerSection[] {
  const lessonUpdateById = new Map(plan.lessonUpdates.map((u) => [u.id, u]));

  const placed: { lesson: PlannerLesson; sectionId: string }[] = [];
  for (const s of sections) {
    for (const l of s.lessons) {
      const u = lessonUpdateById.get(l.id);
      placed.push({
        lesson: {
          ...l,
          order: u ? u.order : l.order,
        },
        sectionId: u ? u.sectionId : s.id,
      });
    }
  }

  return sections.map((s) => ({
    id: s.id,
    lessons: placed
      .filter((p) => p.sectionId === s.id)
      .map((p) => p.lesson)
      .sort((a, b) => a.order - b.order),
  }));
}
