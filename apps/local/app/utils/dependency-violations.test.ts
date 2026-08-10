import { describe, expect, it } from "vitest";
import {
  findNewOrderViolations,
  findNewSectionOrderViolations,
  type LessonForViolationCheck,
  type SectionForViolationCheck,
} from "./dependency-violations";

const makeLesson = (id: string, deps?: string[]): LessonForViolationCheck => ({
  id,
  title: `Lesson ${id}`,
  path: `01.0${id}-lesson-${id}`,
  dependencies: deps ?? [],
});

describe("findNewOrderViolations", () => {
  it("returns empty when no dependencies exist", () => {
    const lessons = [makeLesson("1"), makeLesson("2"), makeLesson("3")];
    const reordered = [lessons[2]!, lessons[0]!, lessons[1]!];

    expect(findNewOrderViolations(lessons, reordered)).toEqual([]);
  });

  it("returns empty when reorder does not introduce violations", () => {
    // B depends on A. A is before B in both old and new order.
    const A = makeLesson("A");
    const B = makeLesson("B", ["A"]);
    const C = makeLesson("C");

    const oldOrder = [A, B, C];
    const newOrder = [A, C, B]; // B still after A

    expect(findNewOrderViolations(oldOrder, newOrder)).toEqual([]);
  });

  it("detects new violation when dependency moves after the lesson", () => {
    // B depends on A. Old order: A, B (ok). New order: B, A (violation).
    const A = makeLesson("A");
    const B = makeLesson("B", ["A"]);

    const oldOrder = [A, B];
    const newOrder = [B, A];

    const violations = findNewOrderViolations(oldOrder, newOrder);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      lessonId: "B",
      lessonLabel: "Lesson B",
      depId: "A",
      depLabel: "Lesson A",
    });
  });

  it("does not report pre-existing violations", () => {
    // B depends on A. Old order: B, A (already violated). New order: B, C, A (still violated).
    const A = makeLesson("A");
    const B = makeLesson("B", ["A"]);
    const C = makeLesson("C");

    const oldOrder = [B, A, C];
    const newOrder = [B, C, A];

    expect(findNewOrderViolations(oldOrder, newOrder)).toEqual([]);
  });

  it("ignores cross-section dependencies", () => {
    // B depends on X (not in this section). Reordering should not flag it.
    const A = makeLesson("A");
    const B = makeLesson("B", ["X"]);

    const oldOrder = [A, B];
    const newOrder = [B, A];

    expect(findNewOrderViolations(oldOrder, newOrder)).toEqual([]);
  });

  it("detects multiple new violations", () => {
    // C depends on A, D depends on B. Old: A, B, C, D. New: C, D, A, B.
    const A = makeLesson("A");
    const B = makeLesson("B");
    const C = makeLesson("C", ["A"]);
    const D = makeLesson("D", ["B"]);

    const oldOrder = [A, B, C, D];
    const newOrder = [C, D, A, B];

    const violations = findNewOrderViolations(oldOrder, newOrder);
    expect(violations).toHaveLength(2);
    expect(violations).toContainEqual({
      lessonId: "C",
      lessonLabel: "Lesson C",
      depId: "A",
      depLabel: "Lesson A",
    });
    expect(violations).toContainEqual({
      lessonId: "D",
      lessonLabel: "Lesson D",
      depId: "B",
      depLabel: "Lesson B",
    });
  });

  it("reports only new violations when some pre-exist", () => {
    // B depends on A, C depends on A.
    // Old: B, A, C (B→A violated, C→A ok).
    // New: C, B, A (B→A still violated, C→A now violated).
    const A = makeLesson("A");
    const B = makeLesson("B", ["A"]);
    const C = makeLesson("C", ["A"]);

    const oldOrder = [B, A, C];
    const newOrder = [C, B, A];

    const violations = findNewOrderViolations(oldOrder, newOrder);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      lessonId: "C",
      lessonLabel: "Lesson C",
      depId: "A",
      depLabel: "Lesson A",
    });
  });

  it("handles lessons with no dependencies field (null)", () => {
    const A: LessonForViolationCheck = {
      id: "A",
      path: "01.01-a",
      dependencies: null,
    };
    const B = makeLesson("B");

    expect(findNewOrderViolations([A, B], [B, A])).toEqual([]);
  });

  it("returns empty for identical orderings", () => {
    const A = makeLesson("A");
    const B = makeLesson("B", ["A"]);

    expect(findNewOrderViolations([A, B], [A, B])).toEqual([]);
  });

  it("uses path as label when title is null", () => {
    const A: LessonForViolationCheck = {
      id: "A",
      title: null,
      path: "01.01-intro",
      dependencies: [],
    };
    const B: LessonForViolationCheck = {
      id: "B",
      title: null,
      path: "01.02-setup",
      dependencies: ["A"],
    };

    const violations = findNewOrderViolations([A, B], [B, A]);
    expect(violations[0]!.lessonLabel).toBe("01.02-setup");
    expect(violations[0]!.depLabel).toBe("01.01-intro");
  });
});

const makeSection = (
  id: string,
  lessons: LessonForViolationCheck[]
): SectionForViolationCheck => ({
  id,
  lessons,
});

describe("findNewSectionOrderViolations", () => {
  it("returns empty when no cross-section dependencies exist", () => {
    const s1 = makeSection("s1", [makeLesson("A"), makeLesson("B")]);
    const s2 = makeSection("s2", [makeLesson("C"), makeLesson("D")]);

    expect(findNewSectionOrderViolations([s1, s2], [s2, s1])).toEqual([]);
  });

  it("returns empty when reorder does not introduce violations", () => {
    // C depends on A. S1 has A, S2 has C. Moving S2 after S1 is fine.
    const s1 = makeSection("s1", [makeLesson("A")]);
    const s2 = makeSection("s2", [makeLesson("C", ["A"])]);
    const s3 = makeSection("s3", [makeLesson("D")]);

    // Old: s1, s2, s3. New: s1, s3, s2. C still after A.
    expect(findNewSectionOrderViolations([s1, s2, s3], [s1, s3, s2])).toEqual(
      []
    );
  });

  it("detects new violation when section with dependency moves before its target", () => {
    // C (in s2) depends on A (in s1). Swapping s1 and s2 puts C before A.
    const s1 = makeSection("s1", [makeLesson("A")]);
    const s2 = makeSection("s2", [makeLesson("C", ["A"])]);

    const violations = findNewSectionOrderViolations([s1, s2], [s2, s1]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      lessonId: "C",
      lessonLabel: "Lesson C",
      depId: "A",
      depLabel: "Lesson A",
    });
  });

  it("does not report pre-existing cross-section violations", () => {
    // C (s2) depends on A (s1). Old order: s2, s1 (already violated).
    // New order: s2, s3, s1 (still violated).
    const s1 = makeSection("s1", [makeLesson("A")]);
    const s2 = makeSection("s2", [makeLesson("C", ["A"])]);
    const s3 = makeSection("s3", [makeLesson("D")]);

    expect(findNewSectionOrderViolations([s2, s1, s3], [s2, s3, s1])).toEqual(
      []
    );
  });

  it("ignores within-section dependencies", () => {
    // B depends on A, both in s1. Section reorder can't affect this.
    const s1 = makeSection("s1", [makeLesson("A"), makeLesson("B", ["A"])]);
    const s2 = makeSection("s2", [makeLesson("C")]);

    expect(findNewSectionOrderViolations([s1, s2], [s2, s1])).toEqual([]);
  });

  it("detects multiple new violations across sections", () => {
    // C depends on A (s1→s2), D depends on B (s1→s2). Swapping introduces both.
    const s1 = makeSection("s1", [makeLesson("A"), makeLesson("B")]);
    const s2 = makeSection("s2", [
      makeLesson("C", ["A"]),
      makeLesson("D", ["B"]),
    ]);

    const violations = findNewSectionOrderViolations([s1, s2], [s2, s1]);
    expect(violations).toHaveLength(2);
    expect(violations).toContainEqual({
      lessonId: "C",
      lessonLabel: "Lesson C",
      depId: "A",
      depLabel: "Lesson A",
    });
    expect(violations).toContainEqual({
      lessonId: "D",
      lessonLabel: "Lesson D",
      depId: "B",
      depLabel: "Lesson B",
    });
  });

  it("reports only new violations when some pre-exist", () => {
    // C depends on A, D depends on B.
    // Old: s2(C,D), s1(A,B), s3(E) — C→A and D→B already violated.
    // New: s2(C,D), s3(E), s1(A,B) — same violations, no new ones.
    // But if E depends on B: Old s3 after s1, no violation. New s3 before s1, new violation.
    const s1 = makeSection("s1", [makeLesson("A"), makeLesson("B")]);
    const s2 = makeSection("s2", [makeLesson("C", ["A"])]);
    const s3 = makeSection("s3", [makeLesson("E", ["B"])]);

    // Old: s2, s1, s3. C→A violated, E→B ok.
    // New: s2, s3, s1. C→A still violated, E→B now violated.
    const violations = findNewSectionOrderViolations(
      [s2, s1, s3],
      [s2, s3, s1]
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({
      lessonId: "E",
      lessonLabel: "Lesson E",
      depId: "B",
      depLabel: "Lesson B",
    });
  });

  it("handles lessons with null dependencies", () => {
    const s1 = makeSection("s1", [
      { id: "A", title: null, path: "01.01-a", dependencies: null },
    ]);
    const s2 = makeSection("s2", [makeLesson("B")]);

    expect(findNewSectionOrderViolations([s1, s2], [s2, s1])).toEqual([]);
  });

  it("returns empty for identical orderings", () => {
    const s1 = makeSection("s1", [makeLesson("A")]);
    const s2 = makeSection("s2", [makeLesson("B", ["A"])]);

    expect(findNewSectionOrderViolations([s1, s2], [s1, s2])).toEqual([]);
  });
});
