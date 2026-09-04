import { describe, expect, it } from "vitest";
import {
  planLessonMove,
  planLessonsMove,
  type PlannerSection,
} from "./lesson-move-planner.js";

/** Compact builder for a lesson. */
const lesson = (id: string, order: number) => ({ id, order });

/** Maps lessonUpdates to a {id: {sectionId, order}} lookup. */
const byId = (updates: { id: string; sectionId: string; order: number }[]) =>
  Object.fromEntries(updates.map((u) => [u.id, u]));

describe("planLessonMove", () => {
  describe("guards", () => {
    it("is a no-op when the lesson does not exist", () => {
      const sections: PlannerSection[] = [
        { id: "s1", lessons: [lesson("a", 0)] },
        { id: "s2", lessons: [] },
      ];
      const plan = planLessonMove({
        sections,
        lessonId: "missing",
        targetSectionId: "s2",
        beforeLessonId: null,
      });
      expect(plan.noop).toBe(true);
    });

    it("is a no-op when source and target are the same section", () => {
      const sections: PlannerSection[] = [
        { id: "s1", lessons: [lesson("a", 0)] },
      ];
      const plan = planLessonMove({
        sections,
        lessonId: "a",
        targetSectionId: "s1",
        beforeLessonId: null,
      });
      expect(plan.noop).toBe(true);
    });
  });

  describe("append (beforeLessonId = null)", () => {
    it("moves only the dragged lesson; siblings are untouched", () => {
      const sections: PlannerSection[] = [
        {
          id: "s1",
          lessons: [
            lesson("first", 0),
            lesson("second", 1),
            lesson("third", 2),
          ],
        },
        {
          id: "s2",
          lessons: [lesson("existing", 0)],
        },
      ];

      const plan = planLessonMove({
        sections,
        lessonId: "second",
        targetSectionId: "s2",
        beforeLessonId: null,
      });

      const updates = byId(plan.lessonUpdates);
      expect(updates.second).toEqual({
        id: "second",
        sectionId: "s2",
        order: 1,
      });
      // Nothing else is ever touched by a move: order is fractional, and
      // path is derived from title alone, so no sibling needs an update.
      expect(plan.lessonUpdates).toHaveLength(1);
    });
  });

  describe("positional insert (beforeLessonId set)", () => {
    it("inserts before an anchor with a fractional order, touching nothing else", () => {
      const sections: PlannerSection[] = [
        {
          id: "s1",
          lessons: [lesson("moving", 0), lesson("stay", 1)],
        },
        {
          id: "s2",
          lessons: [lesson("t1", 0), lesson("t2", 1), lesson("t3", 2)],
        },
      ];

      const plan = planLessonMove({
        sections,
        lessonId: "moving",
        targetSectionId: "s2",
        beforeLessonId: "t2",
      });

      const updates = byId(plan.lessonUpdates);
      expect(updates.moving!.sectionId).toBe("s2");
      // order strictly between t1 (0) and t2 (1)
      expect(updates.moving!.order).toBeGreaterThan(0);
      expect(updates.moving!.order).toBeLessThan(1);
      expect(plan.lessonUpdates).toHaveLength(1);
    });

    it("inserting before the first lesson yields an order below it", () => {
      const sections: PlannerSection[] = [
        {
          id: "s1",
          lessons: [lesson("a", 0), lesson("b", 1)],
        },
        {
          id: "s2",
          lessons: [lesson("t1", 5)],
        },
      ];
      const plan = planLessonMove({
        sections,
        lessonId: "a",
        targetSectionId: "s2",
        beforeLessonId: "t1",
      });
      const updates = byId(plan.lessonUpdates);
      expect(updates.a!.order).toBeLessThan(5);
    });
  });

  describe("emptying the source / filling the target", () => {
    it("moving into a section that had no lessons still only touches the moved lesson", () => {
      const sections: PlannerSection[] = [
        {
          id: "s1",
          lessons: [lesson("first", 0), lesson("second", 1)],
        },
        {
          id: "s2",
          lessons: [],
        },
      ];

      const plan = planLessonMove({
        sections,
        lessonId: "first",
        targetSectionId: "s2",
        beforeLessonId: null,
      });

      const updates = byId(plan.lessonUpdates);
      expect(updates.first!.sectionId).toBe("s2");
      expect(plan.lessonUpdates).toHaveLength(1);
    });

    it("emptying the source by moving its only lesson still only touches that lesson", () => {
      const sections: PlannerSection[] = [
        {
          id: "s1",
          lessons: [lesson("only", 0)],
        },
        {
          id: "s2",
          lessons: [],
        },
      ];

      const plan = planLessonMove({
        sections,
        lessonId: "only",
        targetSectionId: "s2",
        beforeLessonId: null,
      });

      const updates = byId(plan.lessonUpdates);
      expect(updates.only!.sectionId).toBe("s2");
      expect(plan.lessonUpdates).toHaveLength(1);
    });
  });
});

describe("planLessonsMove", () => {
  it("is a no-op when no lessons are given", () => {
    const sections: PlannerSection[] = [
      { id: "s1", lessons: [lesson("a", 0)] },
      { id: "s2", lessons: [] },
    ];
    const plan = planLessonsMove({
      sections,
      lessonIds: [],
      targetSectionId: "s2",
      beforeLessonId: null,
    });
    expect(plan.noop).toBe(true);
  });

  it("moves a whole selection into another section as one block (append)", () => {
    const sections: PlannerSection[] = [
      {
        id: "s1",
        lessons: [lesson("a", 0), lesson("b", 1), lesson("c", 2)],
      },
      {
        id: "s2",
        lessons: [lesson("x", 0)],
      },
    ];

    // Select a and c (non-contiguous), drop at the end of s2.
    const plan = planLessonsMove({
      sections,
      lessonIds: ["a", "c"],
      targetSectionId: "s2",
      beforeLessonId: null,
    });

    const updates = byId(plan.lessonUpdates);
    expect(updates.a!.sectionId).toBe("s2");
    expect(updates.c!.sectionId).toBe("s2");
    expect(updates.a!.order).toBeLessThan(updates.c!.order);
    expect(updates.a!.order).toBeGreaterThan(0);
    // Only the moved lessons appear in the diff.
    expect(plan.lessonUpdates).toHaveLength(2);
  });

  it("preserves source display order and lands contiguous before the anchor", () => {
    const sections: PlannerSection[] = [
      {
        id: "s1",
        lessons: [lesson("a", 0), lesson("b", 1), lesson("c", 2)],
      },
      {
        id: "s2",
        lessons: [lesson("x", 0), lesson("y", 1)],
      },
    ];

    // Move a, b, c before y. They must land x, a, b, c, y.
    const plan = planLessonsMove({
      sections,
      lessonIds: ["a", "b", "c"],
      targetSectionId: "s2",
      beforeLessonId: "y",
    });

    const updates = byId(plan.lessonUpdates);
    const order = (id: string) => updates[id]?.order ?? -Infinity;
    expect(order("x")).toBeLessThan(order("a"));
    expect(order("a")).toBeLessThan(order("b"));
    expect(order("b")).toBeLessThan(order("c"));
    const yOrder = updates.y ? updates.y.order : 1;
    expect(order("c")).toBeLessThan(yOrder);
  });

  it("matches a single planLessonMove when the selection is one lesson", () => {
    const sections: PlannerSection[] = [
      { id: "s1", lessons: [lesson("a", 0), lesson("b", 1)] },
      { id: "s2", lessons: [lesson("x", 0)] },
    ];
    const single = planLessonMove({
      sections,
      lessonId: "a",
      targetSectionId: "s2",
      beforeLessonId: null,
    });
    const bulk = planLessonsMove({
      sections,
      lessonIds: ["a"],
      targetSectionId: "s2",
      beforeLessonId: null,
    });
    expect(byId(bulk.lessonUpdates)).toEqual(byId(single.lessonUpdates));
  });
});
