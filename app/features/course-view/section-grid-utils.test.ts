import { describe, expect, it } from "vitest";
import {
  computeSectionDependencyRuns,
  computeSectionSwap,
  filterLessons,
} from "./section-grid-utils";
import type { Lesson } from "./course-view-types";

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: "lesson-1",
    sectionId: "section-1",
    previousVersionLessonId: null,
    path: "lesson-path",
    title: null,
    fsStatus: "real",
    description: null,
    icon: null,
    priority: 2,
    dependencies: null,
    authoringStatus: "done",
    createdAt: "2026-01-01",
    order: "a0",
    videos: [],
    ...overrides,
  } as Lesson;
}

const noFilters = {
  priorityFilter: [] as number[],
  iconFilter: [] as string[],
  fsStatusFilter: null as string | null,
  searchQuery: "",
};

describe("filterLessons", () => {
  it("todo filter includes lesson with authoringStatus=todo and videos with clips", () => {
    const lessons = [
      makeLesson({
        authoringStatus: "todo",
        videos: [
          { id: "v1", path: "v.mp4", clipCount: 5, totalDuration: 100 },
        ] as Lesson["videos"],
      }),
    ];
    const { filteredLessons } = filterLessons(lessons, {
      ...noFilters,
      fsStatusFilter: "todo",
    });
    expect(filteredLessons).toHaveLength(1);
  });

  it("todo filter excludes lesson with authoringStatus=done", () => {
    const lessons = [makeLesson({ authoringStatus: "done" })];
    const { filteredLessons } = filterLessons(lessons, {
      ...noFilters,
      fsStatusFilter: "todo",
    });
    expect(filteredLessons).toHaveLength(0);
  });

  it("todo filter excludes ghost lessons", () => {
    const lessons = [makeLesson({ fsStatus: "ghost", authoringStatus: null })];
    const { filteredLessons } = filterLessons(lessons, {
      ...noFilters,
      fsStatusFilter: "todo",
    });
    expect(filteredLessons).toHaveLength(0);
  });

  it("todo filter includes all priorities", () => {
    const lessons = [
      makeLesson({ id: "p1", authoringStatus: "todo", priority: 1 }),
      makeLesson({ id: "p2", authoringStatus: "todo", priority: 2 }),
      makeLesson({ id: "p3", authoringStatus: "todo", priority: 3 }),
    ];
    const { filteredLessons } = filterLessons(lessons, {
      ...noFilters,
      fsStatusFilter: "todo",
    });
    expect(filteredLessons).toHaveLength(3);
  });

  it("todo filter combined with priority filter excludes non-matching priorities", () => {
    const lessons = [
      makeLesson({ id: "p1", authoringStatus: "todo", priority: 1 }),
      makeLesson({ id: "p2", authoringStatus: "todo", priority: 2 }),
    ];
    const { filteredLessons } = filterLessons(lessons, {
      ...noFilters,
      fsStatusFilter: "todo",
      priorityFilter: [1],
    });
    expect(filteredLessons).toHaveLength(1);
    expect(filteredLessons[0]!.id).toBe("p1");
  });

  it("treats null fsStatus as real for todo filter", () => {
    const lessons = [
      makeLesson({
        fsStatus: null as unknown as string,
        authoringStatus: "todo",
      }),
    ];
    const { filteredLessons } = filterLessons(lessons, {
      ...noFilters,
      fsStatusFilter: "todo",
    });
    expect(filteredLessons).toHaveLength(1);
  });

  it("returns all lessons when no filters are active", () => {
    const lessons = [
      makeLesson({ id: "l1", authoringStatus: "todo" }),
      makeLesson({ id: "l2", authoringStatus: "done" }),
      makeLesson({ id: "l3", fsStatus: "ghost", authoringStatus: null }),
    ];
    const { filteredLessons, hasActiveFilters } = filterLessons(
      lessons,
      noFilters
    );
    expect(hasActiveFilters).toBe(false);
    expect(filteredLessons).toHaveLength(3);
  });
});

describe("computeSectionSwap", () => {
  const ids = ["s1", "s2", "s3"];

  it("moves a section up by swapping with its predecessor", () => {
    expect(computeSectionSwap(ids, "s2", "up")).toEqual(["s2", "s1", "s3"]);
  });

  it("moves a section down by swapping with its successor", () => {
    expect(computeSectionSwap(ids, "s2", "down")).toEqual(["s1", "s3", "s2"]);
  });

  it("returns null when moving the first section up", () => {
    expect(computeSectionSwap(ids, "s1", "up")).toBeNull();
  });

  it("returns null when moving the last section down", () => {
    expect(computeSectionSwap(ids, "s3", "down")).toBeNull();
  });

  it("returns null for an unknown section id", () => {
    expect(computeSectionSwap(ids, "unknown", "up")).toBeNull();
  });

  it("works with two sections", () => {
    expect(computeSectionSwap(["a", "b"], "b", "up")).toEqual(["b", "a"]);
    expect(computeSectionSwap(["a", "b"], "a", "down")).toEqual(["b", "a"]);
  });

  it("returns null for a single section in either direction", () => {
    expect(computeSectionSwap(["only"], "only", "up")).toBeNull();
    expect(computeSectionSwap(["only"], "only", "down")).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(computeSectionSwap([], "any", "up")).toBeNull();
    expect(computeSectionSwap([], "any", "down")).toBeNull();
  });

  it("does not mutate the input array", () => {
    const original = ["s1", "s2", "s3"];
    const copy = [...original];
    computeSectionSwap(original, "s2", "up");
    expect(original).toEqual(copy);
  });
});

describe("computeSectionDependencyRuns", () => {
  // A -> B -> C chained by direct backward deps, plus a lone lesson D.
  const chained = [
    makeLesson({ id: "a" }),
    makeLesson({ id: "b", dependencies: ["a"] }),
    makeLesson({ id: "c", dependencies: ["b"] }),
    makeLesson({ id: "d" }),
  ];

  it("groups a contiguous dependency chain and emits adjacent spine pairs", () => {
    const { runs, spinePairs } = computeSectionDependencyRuns(
      chained,
      chained,
      true
    );
    expect(runs.map((r) => r.lessons.map((l) => l.id))).toEqual([
      ["a", "b", "c"],
      ["d"],
    ]);
    expect(spinePairs).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
  });

  it("produces no groups or pairs when disabled", () => {
    const { runs, spinePairs } = computeSectionDependencyRuns(
      chained,
      chained,
      false
    );
    expect(runs).toHaveLength(chained.length);
    expect(spinePairs).toEqual([]);
  });

  it("changes revalidateKey when the rendered order changes", () => {
    const before = computeSectionDependencyRuns(chained, chained, true);
    const reordered = [chained[3]!, ...chained.slice(0, 3)];
    const after = computeSectionDependencyRuns(reordered, reordered, true);
    expect(after.revalidateKey).not.toBe(before.revalidateKey);
  });

  it("changes revalidateKey when a lesson title changes", () => {
    const before = computeSectionDependencyRuns(chained, chained, true);
    const edited = chained.map((l) =>
      l.id === "a" ? makeLesson({ ...l, title: "New title" }) : l
    );
    const after = computeSectionDependencyRuns(edited, edited, true);
    expect(after.revalidateKey).not.toBe(before.revalidateKey);
  });

  it("keeps revalidateKey stable when nothing relevant changes", () => {
    const a = computeSectionDependencyRuns(chained, chained, true);
    const b = computeSectionDependencyRuns(chained, chained, true);
    expect(a.revalidateKey).toBe(b.revalidateKey);
  });
});
