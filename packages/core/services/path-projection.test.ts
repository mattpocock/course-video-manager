import { describe, expect, it } from "vitest";
import {
  rankByOrder,
  deriveSectionPath,
  deriveLessonPath,
  projectVersionPaths,
  attachDerivedPaths,
} from "./path-projection";

describe("rankByOrder", () => {
  it("assigns contiguous 1-based ranks sorted by order asc", () => {
    const reals = [
      { id: "a", order: 1 },
      { id: "b", order: 2 },
      { id: "c", order: 3 },
    ];
    const ranks = rankByOrder(reals);
    expect(ranks).toEqual(
      new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ])
    );
  });

  it("sorts by order ascending regardless of input order", () => {
    const reals = [
      { id: "c", order: 3 },
      { id: "a", order: 1 },
      { id: "b", order: 2 },
    ];
    const ranks = rankByOrder(reals);
    expect(ranks).toEqual(
      new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ])
    );
  });

  it("handles fractional order values", () => {
    const reals = [
      { id: "a", order: 1 },
      { id: "b", order: 1.5 },
      { id: "c", order: 2 },
    ];
    const ranks = rankByOrder(reals);
    expect(ranks).toEqual(
      new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ])
    );
  });

  it("breaks ties on equal order by id ascending", () => {
    const reals = [
      { id: "z-id", order: 1 },
      { id: "a-id", order: 1 },
      { id: "m-id", order: 1 },
    ];
    const ranks = rankByOrder(reals);
    expect(ranks).toEqual(
      new Map([
        ["a-id", 1],
        ["m-id", 2],
        ["z-id", 3],
      ])
    );
  });

  it("returns empty map for empty input", () => {
    const ranks = rankByOrder([]);
    expect(ranks).toEqual(new Map());
  });

  it("handles single item", () => {
    const ranks = rankByOrder([{ id: "only", order: 42 }]);
    expect(ranks).toEqual(new Map([["only", 1]]));
  });
});

describe("deriveSectionPath", () => {
  it("produces NN-slug format from title", () => {
    expect(deriveSectionPath("Introduction", 1)).toBe("01-introduction");
  });

  it("handles title with special characters", () => {
    expect(deriveSectionPath("What's New?", 3)).toBe("03-whats-new");
  });

  it("falls back to 'untitled' for empty title", () => {
    expect(deriveSectionPath("", 2)).toBe("02-untitled");
  });

  it("falls back to 'untitled' for symbols-only title", () => {
    expect(deriveSectionPath("!@#$", 1)).toBe("01-untitled");
  });

  it("zero-pads section number", () => {
    expect(deriveSectionPath("Basics", 5)).toBe("05-basics");
  });

  it("handles double-digit section number", () => {
    expect(deriveSectionPath("Advanced", 12)).toBe("12-advanced");
  });
});

describe("deriveLessonPath", () => {
  it("produces NN.MM-slug format from title", () => {
    expect(deriveLessonPath("Getting Started", 1, 3)).toBe(
      "01.03-getting-started"
    );
  });

  it("handles title with special characters", () => {
    expect(deriveLessonPath("What's Up, Doc?", 2, 1)).toBe(
      "02.01-whats-up-doc"
    );
  });

  it("falls back to 'untitled' for empty title", () => {
    expect(deriveLessonPath("", 1, 1)).toBe("01.01-untitled");
  });

  it("falls back to 'untitled' for symbols-only title", () => {
    expect(deriveLessonPath("!@#", 3, 2)).toBe("03.02-untitled");
  });

  it("zero-pads both numbers", () => {
    expect(deriveLessonPath("Intro", 1, 1)).toBe("01.01-intro");
  });

  it("handles double-digit numbers", () => {
    expect(deriveLessonPath("Deep Dive", 12, 15)).toBe("12.15-deep-dive");
  });
});

describe("projectVersionPaths", () => {
  it("derives paths for all sections and lessons", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "Introduction",
        lessons: [
          { id: "l1", order: 1, title: "Getting Started" },
          { id: "l2", order: 2, title: "Next Steps" },
        ],
      },
      {
        id: "s2",
        order: 2,
        title: "Advanced",
        lessons: [{ id: "l3", order: 1, title: "Deep Dive" }],
      },
    ];
    const paths = projectVersionPaths(sections);
    expect(paths).toEqual(
      new Map([
        ["s1", "01-introduction"],
        ["s2", "02-advanced"],
        ["l1", "01.01-getting-started"],
        ["l2", "01.02-next-steps"],
        ["l3", "02.01-deep-dive"],
      ])
    );
  });

  it("same-slug siblings derive distinct paths by number alone", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "React",
        lessons: [
          { id: "l1", order: 1, title: "React" },
          { id: "l2", order: 2, title: "React" },
        ],
      },
    ];
    const paths = projectVersionPaths(sections);
    expect(paths.get("l1")).toBe("01.01-react");
    expect(paths.get("l2")).toBe("01.02-react");
    expect(paths.get("s1")).toBe("01-react");
  });

  it("mid-list fractional insert renumbers correctly", () => {
    // Simulate a fractional insert between items at order 1 and 2
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "Section",
        lessons: [
          { id: "l1", order: 1, title: "Alpha" },
          { id: "l-new", order: 1.5, title: "Inserted" },
          { id: "l2", order: 2, title: "Beta" },
          { id: "l3", order: 3, title: "Gamma" },
        ],
      },
    ];
    const paths = projectVersionPaths(sections);
    expect(paths.get("l1")).toBe("01.01-alpha");
    expect(paths.get("l-new")).toBe("01.02-inserted");
    expect(paths.get("l2")).toBe("01.03-beta");
    expect(paths.get("l3")).toBe("01.04-gamma");
  });

  it("returns empty map for empty sections", () => {
    const paths = projectVersionPaths([]);
    expect(paths).toEqual(new Map());
  });

  it("handles section with no lessons", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "Empty",
        lessons: [],
      },
    ];
    const paths = projectVersionPaths(sections);
    expect(paths.has("s1")).toBe(false);
  });
});

describe("attachDerivedPaths", () => {
  it("attaches .path to sections and lessons", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "Intro",
        lessons: [{ id: "l1", order: 1, title: "Hello" }],
      },
    ];
    const result = attachDerivedPaths(sections);
    expect(result[0]!.path).toBe("01-intro");
    expect(result[0]!.lessons[0]!.path).toBe("01.01-hello");
  });

  it("preserves all original fields", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "Section",
        extraField: "preserved",
        lessons: [
          {
            id: "l1",
            order: 1,
            title: "Lesson",
            anotherField: 42,
          },
        ],
      },
    ];
    const result = attachDerivedPaths(sections);
    expect((result[0] as any).extraField).toBe("preserved");
    expect((result[0]!.lessons[0] as any).anotherField).toBe(42);
  });

  it("uses section number from section rank in lesson paths", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "First Section",
        lessons: [{ id: "l1", order: 1, title: "A" }],
      },
      {
        id: "s2",
        order: 2,
        title: "Second Section",
        lessons: [{ id: "l2", order: 1, title: "B" }],
      },
    ];
    const result = attachDerivedPaths(sections);
    expect(result[0]!.path).toBe("01-first-section");
    expect(result[0]!.lessons[0]!.path).toBe("01.01-a");
    expect(result[1]!.path).toBe("02-second-section");
    expect(result[1]!.lessons[0]!.path).toBe("02.01-b");
  });
});
