import { describe, expect, it } from "vitest";
import {
  buildSectionPath,
  deriveSectionPath,
  parseSectionPath,
  computeSectionRenumberingPlan,
} from "./section-path-service";

describe("buildSectionPath", () => {
  it("produces NN-slug format", () => {
    expect(buildSectionPath(1, "intro")).toBe("01-intro");
  });

  it("zero-pads single-digit numbers", () => {
    expect(buildSectionPath(3, "advanced")).toBe("03-advanced");
  });

  it("handles double-digit numbers", () => {
    expect(buildSectionPath(12, "deep-dive")).toBe("12-deep-dive");
  });
});

describe("deriveSectionPath", () => {
  it("derives path from title and section number", () => {
    expect(deriveSectionPath("Introduction", 1)).toBe("01-introduction");
  });

  it("falls back to 'untitled' for empty title", () => {
    expect(deriveSectionPath("", 2)).toBe("02-untitled");
  });

  it("falls back to 'untitled' for symbols-only title", () => {
    expect(deriveSectionPath("!@#$", 1)).toBe("01-untitled");
  });
});

describe("parseSectionPath", () => {
  it("parses standard path", () => {
    expect(parseSectionPath("01-intro")).toEqual({
      sectionNumber: 1,
      slug: "intro",
    });
  });

  it("parses double-digit section number", () => {
    expect(parseSectionPath("12-advanced-topic")).toEqual({
      sectionNumber: 12,
      slug: "advanced-topic",
    });
  });

  it("parses multi-word slug", () => {
    expect(parseSectionPath("03-getting-started-with-ts")).toEqual({
      sectionNumber: 3,
      slug: "getting-started-with-ts",
    });
  });

  it("returns null for path without number prefix", () => {
    expect(parseSectionPath("no-number")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSectionPath("")).toBeNull();
  });

  it("returns null for number-only path (no slug)", () => {
    expect(parseSectionPath("03")).toBeNull();
  });

  describe("roundtrip", () => {
    it("buildSectionPath output is parseable by parseSectionPath", () => {
      const built = buildSectionPath(5, "my-section");
      const parsed = parseSectionPath(built);
      expect(parsed).toEqual({
        sectionNumber: 5,
        slug: "my-section",
      });
    });
  });
});

describe("computeSectionRenumberingPlan", () => {
  const makeSections = (slugs: string[]) =>
    slugs.map((slug, i) => ({
      id: `section-${i + 1}`,
      path: buildSectionPath(i + 1, slug),
      hasRealLessons: true,
    }));

  it("returns empty array for empty sections", () => {
    expect(computeSectionRenumberingPlan([], [])).toEqual([]);
  });

  it("returns empty array for empty newOrderIds", () => {
    const sections = makeSections(["intro", "basics"]);
    expect(computeSectionRenumberingPlan(sections, [])).toEqual([]);
  });

  it("returns empty array when order is unchanged (no-op)", () => {
    const sections = makeSections(["intro", "basics", "advanced"]);
    expect(
      computeSectionRenumberingPlan(sections, [
        "section-1",
        "section-2",
        "section-3",
      ])
    ).toEqual([]);
  });

  it("moves last section to first position", () => {
    const sections = makeSections(["intro", "basics", "advanced"]);
    const plan = computeSectionRenumberingPlan(sections, [
      "section-3",
      "section-1",
      "section-2",
    ]);

    expect(plan).toEqual([
      {
        id: "section-3",
        oldPath: "03-advanced",
        newPath: "01-advanced",
        oldSectionNumber: 3,
        newSectionNumber: 1,
      },
      {
        id: "section-1",
        oldPath: "01-intro",
        newPath: "02-intro",
        oldSectionNumber: 1,
        newSectionNumber: 2,
      },
      {
        id: "section-2",
        oldPath: "02-basics",
        newPath: "03-basics",
        oldSectionNumber: 2,
        newSectionNumber: 3,
      },
    ]);
  });

  it("swaps two sections", () => {
    const sections = makeSections(["first", "second"]);
    const plan = computeSectionRenumberingPlan(sections, [
      "section-2",
      "section-1",
    ]);

    expect(plan).toEqual([
      {
        id: "section-2",
        oldPath: "02-second",
        newPath: "01-second",
        oldSectionNumber: 2,
        newSectionNumber: 1,
      },
      {
        id: "section-1",
        oldPath: "01-first",
        newPath: "02-first",
        oldSectionNumber: 1,
        newSectionNumber: 2,
      },
    ]);
  });

  it("only includes sections whose path actually changes", () => {
    const sections = makeSections(["intro", "basics", "advanced", "outro"]);
    // Move basics to end: intro, advanced, outro, basics
    const plan = computeSectionRenumberingPlan(sections, [
      "section-1",
      "section-3",
      "section-4",
      "section-2",
    ]);

    // section-1 stays 01-intro (no change)
    expect(plan.find((r) => r.id === "section-1")).toBeUndefined();
    expect(plan).toHaveLength(3);
  });

  it("skips ghost sections even when their path is numbered", () => {
    // A ghost section can carry a numbered path; real-ness is decided by
    // hasRealLessons, not by whether the path parses.
    const sections = [
      { id: "section-1", path: "01-intro", hasRealLessons: true },
      { id: "section-2", path: "02-concepts", hasRealLessons: false },
      { id: "section-3", path: "03-advanced", hasRealLessons: true },
    ];
    const plan = computeSectionRenumberingPlan(sections, [
      "section-3",
      "section-2",
      "section-1",
    ]);

    // The ghost (section-2) must not be renumbered/renamed on disk.
    expect(plan.find((r) => r.id === "section-2")).toBeUndefined();
    expect(plan.map((r) => r.id)).toEqual(["section-3", "section-1"]);
  });

  it("ignores unknown IDs in newOrderIds", () => {
    const sections = makeSections(["intro", "basics"]);
    const plan = computeSectionRenumberingPlan(sections, [
      "section-2",
      "unknown-id",
      "section-1",
    ]);

    expect(plan).toEqual([
      {
        id: "section-2",
        oldPath: "02-basics",
        newPath: "01-basics",
        oldSectionNumber: 2,
        newSectionNumber: 1,
      },
      {
        id: "section-1",
        oldPath: "01-intro",
        newPath: "03-intro",
        oldSectionNumber: 1,
        newSectionNumber: 3,
      },
    ]);
  });
});
