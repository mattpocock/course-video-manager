import { describe, expect, it } from "vitest";
import {
  planLessonMove,
  planLessonsMove,
  type FsOp,
  type PlannerSection,
} from "./lesson-move-planner";

/** Compact builder for a lesson. */
const real = (id: string, path: string, order: number) => ({
  id,
  path,
  order,
});

/** Maps lessonUpdates to a {id: {sectionId, order}} lookup. */
const byId = (updates: { id: string; sectionId: string; order: number }[]) =>
  Object.fromEntries(updates.map((u) => [u.id, u]));

const fsKinds = (ops: FsOp[]) => ops.map((o) => o.kind);

describe("planLessonMove", () => {
  describe("guards", () => {
    it("is a no-op when the lesson does not exist", () => {
      const sections: PlannerSection[] = [
        { id: "s1", path: "01-intro", lessons: [real("a", "01.01-a", 0)] },
        { id: "s2", path: "02-next", lessons: [] },
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
        { id: "s1", path: "01-intro", lessons: [real("a", "01.01-a", 0)] },
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

  describe("real lesson, append (beforeLessonId = null)", () => {
    it("moves the lesson, renumbers the source to close the gap", () => {
      const sections: PlannerSection[] = [
        {
          id: "s1",
          path: "01-intro",
          lessons: [
            real("first", "01.01-first", 0),
            real("second", "01.02-second", 1),
            real("third", "01.03-third", 2),
          ],
        },
        {
          id: "s2",
          path: "02-advanced",
          lessons: [real("existing", "02.01-existing", 0)],
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
      // Source gap closed on disk, but third's order/sectionId are unchanged
      // so it doesn't appear in the DB diff.
      expect(updates.third).toBeUndefined();
      // First untouched (no update emitted)
      expect(updates.first).toBeUndefined();
      // Existing target lesson untouched (append, nothing shifts)
      expect(updates.existing).toBeUndefined();

      expect(plan.sectionUpdates).toEqual([]);
      expect(fsKinds(plan.fsOps)).toEqual(["moveLesson", "renameLessons"]);
      const move = plan.fsOps[0];
      expect(move).toMatchObject({
        kind: "moveLesson",
        sourceSectionPath: "01-intro",
        targetSectionPath: "02-advanced",
        oldLessonDirName: "01.02-second",
        newLessonDirName: "02.02-second",
      });
    });
  });

  describe("real lesson, positional insert (beforeLessonId set)", () => {
    it("inserts before an anchor and shifts target lessons up", () => {
      const sections: PlannerSection[] = [
        {
          id: "s1",
          path: "01-intro",
          // Two lessons so the source stays real (isolates positional insert
          // from the dematerialize/renumber cascade).
          lessons: [
            real("moving", "01.01-moving", 0),
            real("stay", "01.02-stay", 1),
          ],
        },
        {
          id: "s2",
          path: "02-target",
          lessons: [
            real("t1", "02.01-t1", 0),
            real("t2", "02.02-t2", 1),
            real("t3", "02.03-t3", 2),
          ],
        },
      ];

      // Drop before t2 → moving becomes 02.02, t2/t3 shift up.
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
      expect(updates.t1).toBeUndefined();

      // Source emptied → it dematerializes and sections renumber.
      // Target shift renames must precede the moveLesson so the slot is free.
      const idxShift = plan.fsOps.findIndex(
        (o) => o.kind === "renameLessons" && o.sectionPath === "02-target"
      );
      const idxMove = plan.fsOps.findIndex((o) => o.kind === "moveLesson");
      expect(idxShift).toBeGreaterThanOrEqual(0);
      expect(idxShift).toBeLessThan(idxMove);
    });

    it("inserting before the first lesson yields an order below it", () => {
      const sections: PlannerSection[] = [
        {
          id: "s1",
          path: "01-intro",
          lessons: [real("a", "01.01-a", 0), real("b", "01.02-b", 1)],
        },
        {
          id: "s2",
          path: "02-target",
          lessons: [real("t1", "02.01-t1", 5)],
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

  describe("materialize target / dematerialize source", () => {
    it("numbers a now-non-empty target, keeps numbering when source stays non-empty", () => {
      const sections: PlannerSection[] = [
        {
          id: "s1",
          path: "01-intro",
          lessons: [
            real("first", "01.01-first", 0),
            real("second", "01.02-second", 1),
          ],
        },
        {
          id: "s2",
          path: "Advanced Topics",
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

      const secUpdates = Object.fromEntries(
        plan.sectionUpdates.map((s) => [s.id, s.path])
      );
      expect(secUpdates.s2).toBe("02-advanced-topics");
      expect(secUpdates.s1).toBeUndefined();

      expect(plan.fsOps[0]).toMatchObject({
        kind: "makeSectionDir",
        sectionPath: "02-advanced-topics",
      });
    });

    it("dematerializes the source when its last real lesson leaves", () => {
      const sections: PlannerSection[] = [
        {
          id: "s1",
          path: "01-intro",
          lessons: [real("only", "01.01-only-lesson", 0)],
        },
        {
          id: "s2",
          path: "02-advanced",
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

      const secUpdates = Object.fromEntries(
        plan.sectionUpdates.map((s) => [s.id, s.path])
      );
      // Source reverts to an unnumbered title, target becomes 01.
      expect(secUpdates.s1).toBe("Intro");
      expect(secUpdates.s2).toBe("01-advanced");

      expect(fsKinds(plan.fsOps)).toEqual([
        "makeSectionDir",
        "moveLesson",
        "deleteSectionDir",
        "renameSections",
        "renameLessons",
      ]);
    });
  });
});

describe("planLessonsMove", () => {
  it("is a no-op when no lessons are given", () => {
    const sections: PlannerSection[] = [
      { id: "s1", path: "01-intro", lessons: [real("a", "01.01-a", 0)] },
      { id: "s2", path: "02-next", lessons: [] },
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
        path: "01-intro",
        lessons: [
          real("a", "01.01-a", 0),
          real("b", "01.02-b", 1),
          real("c", "01.03-c", 2),
        ],
      },
      {
        id: "s2",
        path: "02-advanced",
        lessons: [real("x", "02.01-x", 0)],
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
    // Both selected lessons land in the target...
    expect(updates.a!.sectionId).toBe("s2");
    expect(updates.c!.sectionId).toBe("s2");
    // ...appended after the existing target lesson, in selection order a then c.
    expect(updates.a!.order).toBeLessThan(updates.c!.order);
    // x is unchanged (order 0, already first), so it isn't in the diff; the
    // appended block sorts after it.
    expect(updates.x).toBeUndefined();
    expect(updates.a!.order).toBeGreaterThan(0);

    // The unselected source lesson is renumbered on disk, but its
    // order/sectionId are unchanged so it doesn't appear in the DB diff.
    expect(updates.b).toBeUndefined();
  });

  it("preserves source display order and lands contiguous before the anchor", () => {
    const sections: PlannerSection[] = [
      {
        id: "s1",
        path: "01-intro",
        lessons: [
          real("a", "01.01-a", 0),
          real("b", "01.02-b", 1),
          real("c", "01.03-c", 2),
        ],
      },
      {
        id: "s2",
        path: "02-advanced",
        lessons: [real("x", "02.01-x", 0), real("y", "02.02-y", 1)],
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
    // The anchor y ends up after the whole block.
    const yOrder = updates.y ? updates.y.order : 1;
    expect(order("c")).toBeLessThan(yOrder);
  });

  it("dematerializes the source section when the move empties it", () => {
    const sections: PlannerSection[] = [
      {
        id: "s1",
        path: "01-intro",
        lessons: [real("a", "01.01-a", 0), real("b", "01.02-b", 1)],
      },
      {
        id: "s2",
        path: "02-advanced",
        lessons: [real("x", "02.01-x", 0)],
      },
    ];

    // Move both source lessons out → source has no real lessons left.
    const plan = planLessonsMove({
      sections,
      lessonIds: ["a", "b"],
      targetSectionId: "s2",
      beforeLessonId: null,
    });

    const secUpdates = Object.fromEntries(
      plan.sectionUpdates.map((s) => [s.id, s.path])
    );
    // Source reverts to an unnumbered title; target renumbers 02 → 01.
    expect(secUpdates.s1).toBe("Intro");
    expect(secUpdates.s2).toBe("01-advanced");
    expect(plan.fsOps.some((o) => o.kind === "deleteSectionDir")).toBe(true);
  });

  it("matches a single planLessonMove when the selection is one lesson", () => {
    const sections: PlannerSection[] = [
      {
        id: "s1",
        path: "01-intro",
        lessons: [real("a", "01.01-a", 0), real("b", "01.02-b", 1)],
      },
      { id: "s2", path: "02-next", lessons: [real("x", "02.01-x", 0)] },
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
