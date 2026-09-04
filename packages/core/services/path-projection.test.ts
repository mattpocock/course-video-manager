import { describe, expect, it } from "vitest";
import {
  rankByOrder,
  deriveSectionPath,
  deriveLessonPath,
  projectVersionPaths,
  attachDerivedPaths,
} from "./path-projection.js";

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
  it("produces a plain slug from title, no ordering number", () => {
    expect(deriveSectionPath("Introduction")).toBe("introduction");
  });

  it("handles title with special characters", () => {
    expect(deriveSectionPath("What's New?")).toBe("whats-new");
  });

  it("falls back to 'untitled' for empty title", () => {
    expect(deriveSectionPath("")).toBe("untitled");
  });

  it("falls back to 'untitled' for symbols-only title", () => {
    expect(deriveSectionPath("!@#$")).toBe("untitled");
  });
});

describe("deriveLessonPath", () => {
  it("produces a plain slug from title, no ordering number", () => {
    expect(deriveLessonPath("Getting Started")).toBe("getting-started");
  });

  it("handles title with special characters", () => {
    expect(deriveLessonPath("What's Up, Doc?")).toBe("whats-up-doc");
  });

  it("falls back to 'untitled' for empty title", () => {
    expect(deriveLessonPath("")).toBe("untitled");
  });

  it("falls back to 'untitled' for symbols-only title", () => {
    expect(deriveLessonPath("!@#")).toBe("untitled");
  });
});

describe("projectVersionPaths", () => {
  it("derives paths for all sections and lessons from title alone", () => {
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
        ["s1", "introduction"],
        ["s2", "advanced"],
        ["l1", "getting-started"],
        ["l2", "next-steps"],
        ["l3", "deep-dive"],
      ])
    );
  });

  it("reordering sections/lessons never changes any path", () => {
    const sections = [
      {
        id: "s1",
        order: 5,
        title: "Introduction",
        lessons: [{ id: "l1", order: 9, title: "Getting Started" }],
      },
      {
        id: "s2",
        order: 1,
        title: "Advanced",
        lessons: [{ id: "l2", order: 2, title: "Deep Dive" }],
      },
    ];
    const paths = projectVersionPaths(sections);
    expect(paths.get("s1")).toBe("introduction");
    expect(paths.get("s2")).toBe("advanced");
    expect(paths.get("l1")).toBe("getting-started");
    expect(paths.get("l2")).toBe("deep-dive");
  });

  it("disambiguates same-titled sibling sections with a numeric suffix, in rank order", () => {
    const sections = [
      {
        id: "s2",
        order: 2,
        title: "React",
        lessons: [{ id: "l1", order: 1, title: "A" }],
      },
      {
        id: "s1",
        order: 1,
        title: "React",
        lessons: [{ id: "l2", order: 1, title: "B" }],
      },
    ];
    const paths = projectVersionPaths(sections);
    // s1 ranks first (order 1), so it keeps the bare slug; s2 gets the suffix.
    expect(paths.get("s1")).toBe("react");
    expect(paths.get("s2")).toBe("react-2");
  });

  it("disambiguates same-titled sibling lessons within a section, in rank order", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "React",
        lessons: [
          { id: "l2", order: 2, title: "Hooks" },
          { id: "l1", order: 1, title: "Hooks" },
          { id: "l3", order: 3, title: "Hooks" },
        ],
      },
    ];
    const paths = projectVersionPaths(sections);
    expect(paths.get("l1")).toBe("hooks");
    expect(paths.get("l2")).toBe("hooks-2");
    expect(paths.get("l3")).toBe("hooks-3");
  });

  it("lesson slug collisions in different sections don't disambiguate each other", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "Basics",
        lessons: [{ id: "l1", order: 1, title: "Recap" }],
      },
      {
        id: "s2",
        order: 2,
        title: "Advanced",
        lessons: [{ id: "l2", order: 1, title: "Recap" }],
      },
    ];
    const paths = projectVersionPaths(sections);
    expect(paths.get("l1")).toBe("recap");
    expect(paths.get("l2")).toBe("recap");
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
    expect(result[0]!.path).toBe("intro");
    expect(result[0]!.lessons[0]!.path).toBe("hello");
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

  it("does not couple lesson paths to section rank", () => {
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
    expect(result[0]!.path).toBe("first-section");
    expect(result[0]!.lessons[0]!.path).toBe("a");
    expect(result[1]!.path).toBe("second-section");
    expect(result[1]!.lessons[0]!.path).toBe("b");
  });
});
