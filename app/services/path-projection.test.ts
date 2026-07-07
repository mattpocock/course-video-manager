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
  it("derives paths for all real sections and lessons", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "Introduction",
        lessons: [
          { id: "l1", order: 1, title: "Getting Started", fsStatus: "real" },
          { id: "l2", order: 2, title: "Next Steps", fsStatus: "real" },
        ],
      },
      {
        id: "s2",
        order: 2,
        title: "Advanced",
        lessons: [{ id: "l3", order: 1, title: "Deep Dive", fsStatus: "real" }],
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
          { id: "l1", order: 1, title: "React", fsStatus: "real" },
          { id: "l2", order: 2, title: "React", fsStatus: "real" },
        ],
      },
    ];
    const paths = projectVersionPaths(sections);
    expect(paths.get("l1")).toBe("01.01-react");
    expect(paths.get("l2")).toBe("01.02-react");
    expect(paths.get("s1")).toBe("01-react");
  });

  it("ghost sections are excluded from ranking and derive no path", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "Real Section",
        lessons: [
          { id: "l1", order: 1, title: "Lesson One", fsStatus: "real" },
        ],
      },
      {
        id: "s-ghost",
        order: 2,
        title: "Ghost Section",
        lessons: [
          { id: "l-ghost", order: 1, title: "Ghost Lesson", fsStatus: "ghost" },
        ],
      },
      {
        id: "s2",
        order: 3,
        title: "Another Real",
        lessons: [
          { id: "l2", order: 1, title: "Lesson Two", fsStatus: "real" },
        ],
      },
    ];
    const paths = projectVersionPaths(sections);
    expect(paths.has("s-ghost")).toBe(false);
    expect(paths.has("l-ghost")).toBe(false);
    // Real sections are numbered contiguously, skipping the ghost
    expect(paths.get("s1")).toBe("01-real-section");
    expect(paths.get("s2")).toBe("02-another-real");
  });

  it("ghost lessons are excluded from ranking within a real section", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "My Section",
        lessons: [
          { id: "l1", order: 1, title: "First", fsStatus: "real" },
          { id: "l-ghost", order: 2, title: "Planned", fsStatus: "ghost" },
          { id: "l2", order: 3, title: "Second", fsStatus: "real" },
        ],
      },
    ];
    const paths = projectVersionPaths(sections);
    expect(paths.get("l1")).toBe("01.01-first");
    expect(paths.get("l2")).toBe("01.02-second");
    expect(paths.has("l-ghost")).toBe(false);
  });

  it("mid-list fractional insert renumbers correctly", () => {
    // Simulate a fractional insert between items at order 1 and 2
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "Section",
        lessons: [
          { id: "l1", order: 1, title: "Alpha", fsStatus: "real" as const },
          {
            id: "l-new",
            order: 1.5,
            title: "Inserted",
            fsStatus: "real" as const,
          },
          { id: "l2", order: 2, title: "Beta", fsStatus: "real" as const },
          { id: "l3", order: 3, title: "Gamma", fsStatus: "real" as const },
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

  it("handles section with only ghost lessons (ghost section)", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "All Ghosts",
        lessons: [
          { id: "l1", order: 1, title: "Ghost One", fsStatus: "ghost" },
          { id: "l2", order: 2, title: "Ghost Two", fsStatus: "ghost" },
        ],
      },
    ];
    const paths = projectVersionPaths(sections);
    expect(paths.has("s1")).toBe(false);
    expect(paths.has("l1")).toBe(false);
    expect(paths.has("l2")).toBe(false);
  });

  it("handles section with no lessons (ghost section)", () => {
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
  it("attaches .path to real sections and lessons", () => {
    const sections = [
      {
        id: "s1",
        order: 1,
        title: "Intro",
        lessons: [
          { id: "l1", order: 1, title: "Hello", fsStatus: "real" as const },
        ],
      },
    ];
    const result = attachDerivedPaths(sections);
    expect(result[0]!.path).toBe("01-intro");
    expect(result[0]!.lessons[0]!.path).toBe("01.01-hello");
  });

  it("falls back to stored path for ghost sections and ghost lessons", () => {
    const sections = [
      {
        id: "s-real",
        order: 1,
        title: "Real",
        path: "01-real",
        lessons: [
          {
            id: "l1",
            order: 1,
            title: "Lesson",
            path: "01.01-lesson",
            fsStatus: "real" as const,
          },
        ],
      },
      {
        id: "s-ghost",
        order: 2,
        title: "Ghost",
        path: "ghost-stored-path",
        lessons: [
          {
            id: "l-ghost",
            order: 1,
            title: "Nope",
            path: "ghost-lesson-stored-path",
            fsStatus: "ghost" as const,
          },
        ],
      },
    ];
    const result = attachDerivedPaths(sections);
    expect(result[0]!.path).toBe("01-real");
    expect(result[0]!.lessons[0]!.path).toBe("01.01-lesson");
    expect(result[1]!.path).toBe("ghost-stored-path");
    expect(result[1]!.lessons[0]!.path).toBe("ghost-lesson-stored-path");
  });

  it("falls back to title for ghosts when no stored path exists", () => {
    const sections = [
      {
        id: "s-real",
        order: 1,
        title: "Real",
        lessons: [
          { id: "l1", order: 1, title: "Lesson", fsStatus: "real" as const },
        ],
      },
      {
        id: "s-ghost",
        order: 2,
        title: "Ghost Section Title",
        lessons: [
          {
            id: "l-ghost",
            order: 1,
            title: "Ghost Lesson Title",
            fsStatus: "ghost" as const,
          },
        ],
      },
    ];
    const result = attachDerivedPaths(sections);
    expect(result[1]!.path).toBe("Ghost Section Title");
    expect(result[1]!.lessons[0]!.path).toBe("Ghost Lesson Title");
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
            fsStatus: "real" as const,
            anotherField: 42,
          },
        ],
      },
    ];
    const result = attachDerivedPaths(sections);
    expect((result[0] as any).extraField).toBe("preserved");
    expect((result[0]!.lessons[0] as any).anotherField).toBe(42);
  });

  it("uses section number from real section rank in lesson paths", () => {
    const sections = [
      {
        id: "s-ghost",
        order: 1,
        title: "Ghost",
        lessons: [
          { id: "l-g", order: 1, title: "X", fsStatus: "ghost" as const },
        ],
      },
      {
        id: "s1",
        order: 2,
        title: "First Real",
        lessons: [
          { id: "l1", order: 1, title: "A", fsStatus: "real" as const },
        ],
      },
      {
        id: "s2",
        order: 3,
        title: "Second Real",
        lessons: [
          { id: "l2", order: 1, title: "B", fsStatus: "real" as const },
        ],
      },
    ];
    const result = attachDerivedPaths(sections);
    // s1 is rank 1 (ghost skipped), s2 is rank 2
    expect(result[1]!.path).toBe("01-first-real");
    expect(result[1]!.lessons[0]!.path).toBe("01.01-a");
    expect(result[2]!.path).toBe("02-second-real");
    expect(result[2]!.lessons[0]!.path).toBe("02.01-b");
  });
});
