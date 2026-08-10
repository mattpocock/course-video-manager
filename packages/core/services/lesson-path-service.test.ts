import { describe, expect, it } from "vitest";
import {
  toSlug,
  buildLessonPath,
  deriveLessonPath,
  parseLessonPath,
  computeRenumberingPlan,
  computeInsertionPlan,
} from "./lesson-path-service";

describe("toSlug", () => {
  it("converts spaces to dashes", () => {
    expect(toSlug("hello world")).toBe("hello-world");
  });

  it("lowercases input", () => {
    expect(toSlug("Hello World")).toBe("hello-world");
  });

  it("removes special characters", () => {
    expect(toSlug("hello! world?")).toBe("hello-world");
  });

  it("collapses multiple dashes", () => {
    expect(toSlug("hello---world")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(toSlug("-hello-world-")).toBe("hello-world");
  });

  it("trims whitespace", () => {
    expect(toSlug("  hello world  ")).toBe("hello-world");
  });

  it("preserves digits", () => {
    expect(toSlug("lesson 42 intro")).toBe("lesson-42-intro");
  });

  it("passes through already-valid slugs", () => {
    expect(toSlug("already-valid-slug")).toBe("already-valid-slug");
  });

  it("handles empty string", () => {
    expect(toSlug("")).toBe("");
  });

  it("handles mixed case with special characters", () => {
    expect(toSlug("What's Up, Doc?")).toBe("whats-up-doc");
  });
});

describe("buildLessonPath", () => {
  it("produces XX.YY-slug format", () => {
    expect(buildLessonPath(1, 3, "my-lesson")).toBe("01.03-my-lesson");
  });

  it("zero-pads single-digit numbers", () => {
    expect(buildLessonPath(2, 5, "intro")).toBe("02.05-intro");
  });

  it("handles double-digit numbers", () => {
    expect(buildLessonPath(12, 15, "advanced-topic")).toBe(
      "12.15-advanced-topic"
    );
  });

  it("handles section 1 lesson 1", () => {
    expect(buildLessonPath(1, 1, "getting-started")).toBe(
      "01.01-getting-started"
    );
  });
});

describe("deriveLessonPath", () => {
  it("derives path from title and numbers", () => {
    expect(deriveLessonPath("Getting Started", 1, 3)).toBe(
      "01.03-getting-started"
    );
  });

  it("falls back to 'untitled' for empty title", () => {
    expect(deriveLessonPath("", 1, 1)).toBe("01.01-untitled");
  });

  it("falls back to 'untitled' for symbols-only title", () => {
    expect(deriveLessonPath("!@#", 2, 5)).toBe("02.05-untitled");
  });
});

describe("parseLessonPath", () => {
  describe("two-digit format (XX.YY-slug)", () => {
    it("parses standard path", () => {
      expect(parseLessonPath("01.03-my-lesson")).toEqual({
        sectionNumber: 1,
        lessonNumber: 3,
        slug: "my-lesson",
      });
    });

    it("parses double-digit numbers", () => {
      expect(parseLessonPath("12.15-advanced-topic")).toEqual({
        sectionNumber: 12,
        lessonNumber: 15,
        slug: "advanced-topic",
      });
    });

    it("preserves full slug with multiple dashes", () => {
      expect(parseLessonPath("01.01-getting-started-with-ts")).toEqual({
        sectionNumber: 1,
        lessonNumber: 1,
        slug: "getting-started-with-ts",
      });
    });
  });

  describe("three-digit / legacy format (NNN-slug)", () => {
    it("parses standard 3-digit path", () => {
      expect(parseLessonPath("003-example")).toEqual({
        sectionNumber: undefined,
        lessonNumber: 3,
        slug: "example",
      });
    });

    it("parses path with decimal lesson number", () => {
      expect(parseLessonPath("003.5-extended-example")).toEqual({
        sectionNumber: undefined,
        lessonNumber: 3.5,
        slug: "extended-example",
      });
    });

    it("parses single-digit legacy path", () => {
      expect(parseLessonPath("1-intro")).toEqual({
        sectionNumber: undefined,
        lessonNumber: 1,
        slug: "intro",
      });
    });
  });

  describe("invalid paths", () => {
    it("returns null for path without number prefix", () => {
      expect(parseLessonPath("no-number")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseLessonPath("")).toBeNull();
    });

    it("returns null for number-only path (no slug)", () => {
      expect(parseLessonPath("003")).toBeNull();
    });
  });

  describe("roundtrip", () => {
    it("buildLessonPath output is parseable by parseLessonPath", () => {
      const built = buildLessonPath(3, 7, "my-lesson");
      const parsed = parseLessonPath(built);
      expect(parsed).toEqual({
        sectionNumber: 3,
        lessonNumber: 7,
        slug: "my-lesson",
      });
    });
  });
});

describe("computeRenumberingPlan", () => {
  const makeLessons = (slugs: string[], sectionNumber = 1) =>
    slugs.map((slug, i) => ({
      id: `lesson-${i + 1}`,
      path: buildLessonPath(sectionNumber, i + 1, slug),
    }));

  it("returns empty array for empty lessons", () => {
    expect(computeRenumberingPlan([], [])).toEqual([]);
  });

  it("returns empty array for empty newOrderIds", () => {
    const lessons = makeLessons(["alpha", "beta"]);
    expect(computeRenumberingPlan(lessons, [])).toEqual([]);
  });

  it("returns empty array when order is unchanged (no-op)", () => {
    const lessons = makeLessons(["alpha", "beta", "gamma"]);
    expect(
      computeRenumberingPlan(lessons, ["lesson-1", "lesson-2", "lesson-3"])
    ).toEqual([]);
  });

  it("moves last lesson to first position", () => {
    const lessons = makeLessons(["alpha", "beta", "gamma"]);
    // New order: gamma, alpha, beta
    const plan = computeRenumberingPlan(lessons, [
      "lesson-3",
      "lesson-1",
      "lesson-2",
    ]);

    expect(plan).toEqual([
      { id: "lesson-3", oldPath: "01.03-gamma", newPath: "01.01-gamma" },
      { id: "lesson-1", oldPath: "01.01-alpha", newPath: "01.02-alpha" },
      { id: "lesson-2", oldPath: "01.02-beta", newPath: "01.03-beta" },
    ]);
  });

  it("moves first lesson to last position", () => {
    const lessons = makeLessons(["alpha", "beta", "gamma"]);
    // New order: beta, gamma, alpha
    const plan = computeRenumberingPlan(lessons, [
      "lesson-2",
      "lesson-3",
      "lesson-1",
    ]);

    expect(plan).toEqual([
      { id: "lesson-2", oldPath: "01.02-beta", newPath: "01.01-beta" },
      { id: "lesson-3", oldPath: "01.03-gamma", newPath: "01.02-gamma" },
      { id: "lesson-1", oldPath: "01.01-alpha", newPath: "01.03-alpha" },
    ]);
  });

  it("moves a middle lesson down one position", () => {
    const lessons = makeLessons(["alpha", "beta", "gamma", "delta"]);
    // New order: alpha, gamma, beta, delta
    const plan = computeRenumberingPlan(lessons, [
      "lesson-1",
      "lesson-3",
      "lesson-2",
      "lesson-4",
    ]);

    // alpha stays 01.01 (no change), gamma: 01.03→01.02, beta: 01.02→01.03, delta stays 01.04
    expect(plan).toEqual([
      { id: "lesson-3", oldPath: "01.03-gamma", newPath: "01.02-gamma" },
      { id: "lesson-2", oldPath: "01.02-beta", newPath: "01.03-beta" },
    ]);
  });

  it("handles single lesson with same order (no-op)", () => {
    const lessons = makeLessons(["only-lesson"]);
    expect(computeRenumberingPlan(lessons, ["lesson-1"])).toEqual([]);
  });

  it("preserves section number from existing paths", () => {
    const lessons = [
      { id: "a", path: "03.01-intro" },
      { id: "b", path: "03.02-basics" },
      { id: "c", path: "03.03-advanced" },
    ];
    // New order: advanced, intro, basics
    const plan = computeRenumberingPlan(lessons, ["c", "a", "b"]);

    expect(plan).toEqual([
      { id: "c", oldPath: "03.03-advanced", newPath: "03.01-advanced" },
      { id: "a", oldPath: "03.01-intro", newPath: "03.02-intro" },
      { id: "b", oldPath: "03.02-basics", newPath: "03.03-basics" },
    ]);
  });

  it("only includes lessons whose path actually changes", () => {
    const lessons = makeLessons(["alpha", "beta", "gamma", "delta", "epsilon"]);
    // New order: alpha, delta, beta, gamma, epsilon
    const plan = computeRenumberingPlan(lessons, [
      "lesson-1",
      "lesson-4",
      "lesson-2",
      "lesson-3",
      "lesson-5",
    ]);

    // alpha stays 01.01, epsilon stays 01.05
    expect(plan).toHaveLength(3);
    expect(plan.find((r) => r.id === "lesson-1")).toBeUndefined();
    expect(plan.find((r) => r.id === "lesson-5")).toBeUndefined();
  });

  it("handles two lessons swapping positions", () => {
    const lessons = makeLessons(["first", "second"]);
    // New order: second, first
    const plan = computeRenumberingPlan(lessons, ["lesson-2", "lesson-1"]);

    expect(plan).toEqual([
      { id: "lesson-2", oldPath: "01.02-second", newPath: "01.01-second" },
      { id: "lesson-1", oldPath: "01.01-first", newPath: "01.02-first" },
    ]);
  });

  it("ignores unknown IDs in newOrderIds", () => {
    const lessons = makeLessons(["alpha", "beta"]);
    const plan = computeRenumberingPlan(lessons, [
      "lesson-2",
      "unknown-id",
      "lesson-1",
    ]);

    // unknown-id is skipped; lesson-2 becomes position 1, lesson-1 becomes position 3
    expect(plan).toEqual([
      { id: "lesson-2", oldPath: "01.02-beta", newPath: "01.01-beta" },
      { id: "lesson-1", oldPath: "01.01-alpha", newPath: "01.03-alpha" },
    ]);
  });
});

describe("computeInsertionPlan", () => {
  const makeLessons = (slugs: string[], sectionNumber = 1) =>
    slugs.map((slug, i) => ({
      id: `lesson-${i + 1}`,
      path: buildLessonPath(sectionNumber, i + 1, slug),
    }));

  it("inserts between two existing lessons", () => {
    const existing = makeLessons(["alpha", "beta", "gamma"]);
    // Insert at position 1 (between alpha and beta)
    const plan = computeInsertionPlan({
      existingRealLessons: existing,
      insertAtIndex: 1,
      sectionNumber: 1,
      slug: "new-lesson",
    });

    expect(plan.newLessonDirName).toBe("01.02-new-lesson");
    expect(plan.newLessonNumber).toBe(2);
    expect(plan.renames).toEqual([
      { id: "lesson-2", oldPath: "01.02-beta", newPath: "01.03-beta" },
      { id: "lesson-3", oldPath: "01.03-gamma", newPath: "01.04-gamma" },
    ]);
  });

  it("appends at the end with no renumbering", () => {
    const existing = makeLessons(["alpha", "beta"]);
    const plan = computeInsertionPlan({
      existingRealLessons: existing,
      insertAtIndex: 2,
      sectionNumber: 1,
      slug: "new-lesson",
    });

    expect(plan.newLessonDirName).toBe("01.03-new-lesson");
    expect(plan.newLessonNumber).toBe(3);
    expect(plan.renames).toEqual([]);
  });

  it("inserts at the beginning and shifts all lessons", () => {
    const existing = makeLessons(["alpha", "beta"]);
    const plan = computeInsertionPlan({
      existingRealLessons: existing,
      insertAtIndex: 0,
      sectionNumber: 1,
      slug: "new-lesson",
    });

    expect(plan.newLessonDirName).toBe("01.01-new-lesson");
    expect(plan.newLessonNumber).toBe(1);
    expect(plan.renames).toEqual([
      { id: "lesson-1", oldPath: "01.01-alpha", newPath: "01.02-alpha" },
      { id: "lesson-2", oldPath: "01.02-beta", newPath: "01.03-beta" },
    ]);
  });

  it("inserts into an empty section", () => {
    const plan = computeInsertionPlan({
      existingRealLessons: [],
      insertAtIndex: 0,
      sectionNumber: 3,
      slug: "first-lesson",
    });

    expect(plan.newLessonDirName).toBe("03.01-first-lesson");
    expect(plan.newLessonNumber).toBe(1);
    expect(plan.renames).toEqual([]);
  });

  it("preserves section number from input", () => {
    const existing = [
      { id: "a", path: "05.01-intro" },
      { id: "b", path: "05.02-basics" },
    ];
    const plan = computeInsertionPlan({
      existingRealLessons: existing,
      insertAtIndex: 1,
      sectionNumber: 5,
      slug: "middle",
    });

    expect(plan.newLessonDirName).toBe("05.02-middle");
    expect(plan.renames).toEqual([
      { id: "b", oldPath: "05.02-basics", newPath: "05.03-basics" },
    ]);
  });
});
