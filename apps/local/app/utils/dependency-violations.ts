/**
 * Detects new dependency order violations introduced by reordering lessons
 * within a single section, or by reordering sections.
 *
 * A violation occurs when a lesson depends on another lesson that appears
 * AFTER it in the ordering. "New" means the violation exists in the new
 * order but not in the old order.
 */

export interface LessonForViolationCheck {
  id: string;
  title?: string | null;
  path: string;
  dependencies?: string[] | null;
}

export interface SectionForViolationCheck {
  id: string;
  lessons: LessonForViolationCheck[];
}

export interface OrderViolation {
  lessonId: string;
  lessonLabel: string;
  depId: string;
  depLabel: string;
}

/**
 * Given the old and new orderings of lessons in a section, returns any
 * dependency order violations that are NEW (present in the new order
 * but not in the old order).
 *
 * Only checks within-section dependencies — cross-section violations
 * cannot change from within-section reordering.
 */
export const findNewOrderViolations = (
  oldOrder: LessonForViolationCheck[],
  newOrder: LessonForViolationCheck[]
): OrderViolation[] => {
  const sectionLessonIds = new Set(oldOrder.map((l) => l.id));

  const oldViolations = computeWithinSectionViolations(
    oldOrder,
    sectionLessonIds
  );
  const newViolations = computeWithinSectionViolations(
    newOrder,
    sectionLessonIds
  );

  // Return only violations that are new (not in old set)
  return newViolations.filter(
    (v) =>
      !oldViolations.some(
        (ov) => ov.lessonId === v.lessonId && ov.depId === v.depId
      )
  );
};

/**
 * Given the old and new orderings of sections (each containing their lessons),
 * returns any cross-section dependency violations that are NEW.
 *
 * A cross-section violation occurs when a lesson depends on a lesson in a
 * section that comes AFTER it. Only checks cross-section deps — within-section
 * violations are handled by findNewOrderViolations.
 */
export const findNewSectionOrderViolations = (
  oldOrder: SectionForViolationCheck[],
  newOrder: SectionForViolationCheck[]
): OrderViolation[] => {
  const oldViolations = computeCrossSectionViolations(oldOrder);
  const newViolations = computeCrossSectionViolations(newOrder);

  return newViolations.filter(
    (v) =>
      !oldViolations.some(
        (ov) => ov.lessonId === v.lessonId && ov.depId === v.depId
      )
  );
};

function computeCrossSectionViolations(
  sections: SectionForViolationCheck[]
): OrderViolation[] {
  const violations: OrderViolation[] = [];

  // Map each lesson ID to its section index and lesson data
  const lessonToSectionIdx = new Map<string, number>();
  const lessonMap = new Map<string, LessonForViolationCheck>();

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    for (const lesson of sections[sIdx]!.lessons) {
      lessonToSectionIdx.set(lesson.id, sIdx);
      lessonMap.set(lesson.id, lesson);
    }
  }

  for (let sIdx = 0; sIdx < sections.length; sIdx++) {
    for (const lesson of sections[sIdx]!.lessons) {
      const deps = lesson.dependencies ?? [];
      for (const depId of deps) {
        const depSectionIdx = lessonToSectionIdx.get(depId);
        if (depSectionIdx === undefined || depSectionIdx === sIdx) continue;

        if (depSectionIdx > sIdx) {
          const dep = lessonMap.get(depId)!;
          violations.push({
            lessonId: lesson.id,
            lessonLabel: lesson.title || lesson.path,
            depId,
            depLabel: dep.title || dep.path,
          });
        }
      }
    }
  }

  return violations;
}

function computeWithinSectionViolations(
  lessons: LessonForViolationCheck[],
  sectionLessonIds: Set<string>
): OrderViolation[] {
  const violations: OrderViolation[] = [];
  const indexMap = new Map(lessons.map((l, i) => [l.id, i]));

  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i]!;
    const deps = lesson.dependencies ?? [];

    for (const depId of deps) {
      // Only check dependencies within the same section
      if (!sectionLessonIds.has(depId)) continue;

      const depIdx = indexMap.get(depId);
      if (depIdx !== undefined && depIdx > i) {
        const dep = lessons[depIdx]!;
        violations.push({
          lessonId: lesson.id,
          lessonLabel: lesson.title || lesson.path,
          depId,
          depLabel: dep.title || dep.path,
        });
      }
    }
  }

  return violations;
}
