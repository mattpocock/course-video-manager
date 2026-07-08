import { describe, expect, it } from "vitest";
import {
  resolveLessonDrop,
  computeReorderIds,
  computeBulkReorderIds,
  buildLessonDropEvent,
  computeTodoCount,
  computeCourseStats,
} from "./course-editor-helpers";
import type { DragEndEvent } from "@dnd-kit/core";
import type { Section, Lesson } from "./course-view-types";

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: "lesson-1",
    sectionId: "section-1",
    previousVersionLessonId: null,
    path: "lesson-path",
    title: null,
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

function makeSection(
  lessons: Lesson[],
  overrides: Partial<Section> = {}
): Section {
  return {
    id: "section-1",
    path: "section-path",
    order: "a0",
    lessons,
    ...overrides,
  } as Section;
}

const noFilters = { priorityFilter: [], iconFilter: [], searchQuery: "" };

// Fake DragEndEvent. `activeRect`/`overRect` default to a no-translation drag
// (the dragged card's centre resolves above the hovered lesson → insert-before).
function makeDragEndEvent(
  activeId: string,
  overId: string,
  opts: {
    activeRect?: { top: number; height: number };
    overRect?: { top: number; height: number };
  } = {}
): DragEndEvent {
  return {
    active: {
      id: activeId,
      data: { current: undefined },
      rect: {
        current: {
          initial: null,
          translated: opts.activeRect
            ? { top: opts.activeRect.top, height: opts.activeRect.height }
            : null,
        },
      },
    },
    over: {
      id: overId,
      data: { current: undefined },
      rect: {
        left: 0,
        right: 0,
        top: opts.overRect?.top ?? 0,
        bottom: 0,
        width: 0,
        height: opts.overRect?.height ?? 0,
      },
    },
    activatorEvent: {} as Event,
    collisions: null,
    delta: { x: 0, y: 0 },
  } as unknown as DragEndEvent;
}

const dropSections = [
  { id: "s1", lessons: [{ id: "a" }, { id: "b" }, { id: "c" }] },
  { id: "s2", lessons: [{ id: "x" }, { id: "y" }] },
];

describe("resolveLessonDrop", () => {
  it("returns null when over is null", () => {
    const event = {
      active: { id: "a", rect: { current: { translated: null } } },
      over: null,
    } as unknown as DragEndEvent;
    expect(resolveLessonDrop(event, dropSections)).toBeNull();
  });

  it("appends when dropping over a section container", () => {
    expect(
      resolveLessonDrop(makeDragEndEvent("a", "s2"), dropSections)
    ).toEqual({ targetSectionId: "s2", beforeLessonId: null });
  });

  it("inserts before the hovered lesson when dragged above its centre", () => {
    expect(resolveLessonDrop(makeDragEndEvent("a", "y"), dropSections)).toEqual(
      {
        targetSectionId: "s2",
        beforeLessonId: "y",
      }
    );
  });

  it("inserts after the hovered lesson when dragged below its centre", () => {
    // active centre 110 > over (x) centre 10 → after x → anchored before y
    const event = makeDragEndEvent("a", "x", {
      activeRect: { top: 100, height: 20 },
      overRect: { top: 0, height: 20 },
    });
    expect(resolveLessonDrop(event, dropSections)).toEqual({
      targetSectionId: "s2",
      beforeLessonId: "y",
    });
  });

  it("appends when dragged below the last lesson", () => {
    const event = makeDragEndEvent("a", "y", {
      activeRect: { top: 100, height: 20 },
      overRect: { top: 0, height: 20 },
    });
    expect(resolveLessonDrop(event, dropSections)).toEqual({
      targetSectionId: "s2",
      beforeLessonId: null,
    });
  });
});

describe("computeReorderIds", () => {
  const lessons = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("moves a lesson before an anchor", () => {
    expect(computeReorderIds(lessons, "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("appends when beforeLessonId is null", () => {
    expect(computeReorderIds(lessons, "a", null)).toEqual(["b", "c", "a"]);
  });

  it("returns null when anchoring on itself", () => {
    expect(computeReorderIds(lessons, "a", "a")).toBeNull();
  });

  it("returns null when the order is unchanged", () => {
    expect(computeReorderIds(lessons, "a", "b")).toBeNull();
  });
});

describe("computeBulkReorderIds", () => {
  const lessons = [
    { id: "a" },
    { id: "b" },
    { id: "c" },
    { id: "d" },
    { id: "e" },
  ];

  it("collapses a non-contiguous selection to a contiguous block at the anchor", () => {
    // a, b, c, d, e → select a + c, drop before d → b, a, c, d, e
    expect(computeBulkReorderIds(lessons, new Set(["a", "c"]), "d")).toEqual([
      "b",
      "a",
      "c",
      "d",
      "e",
    ]);
  });

  it("preserves relative order of selected lessons", () => {
    // a, b, c, d, e → select e + b, drop before a → e, b kept in original order → b, e, a, c, d
    expect(computeBulkReorderIds(lessons, new Set(["e", "b"]), "a")).toEqual([
      "b",
      "e",
      "a",
      "c",
      "d",
    ]);
  });

  it("appends when beforeLessonId is null", () => {
    expect(computeBulkReorderIds(lessons, new Set(["a", "c"]), null)).toEqual([
      "b",
      "d",
      "e",
      "a",
      "c",
    ]);
  });

  it("returns null when the order is unchanged (already contiguous at anchor)", () => {
    // a, b, c, d, e → select b + c, drop before d → b, c already before d → no-op
    expect(computeBulkReorderIds(lessons, new Set(["b", "c"]), "d")).toBeNull();
  });

  it("returns null when appending an already-trailing selection", () => {
    expect(
      computeBulkReorderIds(lessons, new Set(["d", "e"]), null)
    ).toBeNull();
  });

  it("handles selection containing the anchor", () => {
    // a, b, c, d, e → select a + c + d, drop before d → selected are spliced out, reinserted before where d was
    // without = [b, e], anchor d was selected so insert at end of remaining? No — anchor is in selected set.
    // The anchor is part of the selection; anchor resolves to the position of d in the *without* array.
    // Since d is removed, the before-anchor fallback puts them where d would have been.
    expect(
      computeBulkReorderIds(lessons, new Set(["a", "c", "d"]), "d")
    ).toEqual(["b", "a", "c", "d", "e"]);
  });

  it("preserves order for any mix of IDs (no special-casing)", () => {
    const mixed = [{ id: "l3" }, { id: "l1" }, { id: "l4" }, { id: "l2" }];
    expect(computeBulkReorderIds(mixed, new Set(["l1", "l2"]), "l3")).toEqual([
      "l1",
      "l2",
      "l3",
      "l4",
    ]);
  });

  it("returns null for a single selected lesson that stays in place", () => {
    expect(computeBulkReorderIds(lessons, new Set(["b"]), "c")).toBeNull();
  });

  it("works with a single selected lesson that moves", () => {
    expect(computeBulkReorderIds(lessons, new Set(["c"]), "a")).toEqual([
      "c",
      "a",
      "b",
      "d",
      "e",
    ]);
  });

  it("handles an anchor not in the lessons list (fallback to append)", () => {
    expect(
      computeBulkReorderIds(lessons, new Set(["a", "b"]), "unknown")
    ).toEqual(["c", "d", "e", "a", "b"]);
  });
});

describe("buildLessonDropEvent", () => {
  const sections = [
    {
      id: "s1",
      lessons: [
        { id: "a" },
        { id: "b" },
        { id: "c" },
        { id: "d" },
        { id: "e" },
      ],
    },
    { id: "s2", lessons: [{ id: "x" }, { id: "y" }] },
  ];

  it("bulk-reorders all selected lessons when bulkDragIds has multiple IDs", () => {
    const result = buildLessonDropEvent({
      sections,
      lessonId: "c",
      drop: { targetSectionId: "s1", beforeLessonId: "e" },
      bulkDragIds: new Set(["a", "c"]),
    });
    expect(result).toEqual({
      type: "reorder-lessons",
      sectionId: "s1",
      lessonIds: ["b", "d", "a", "c", "e"],
    });
  });

  it("single-reorders when bulkDragIds is null", () => {
    const result = buildLessonDropEvent({
      sections,
      lessonId: "c",
      drop: { targetSectionId: "s1", beforeLessonId: "e" },
      bulkDragIds: null,
    });
    expect(result).toEqual({
      type: "reorder-lessons",
      sectionId: "s1",
      lessonIds: ["a", "b", "d", "c", "e"],
    });
  });

  it("single-reorders when bulkDragIds has only one ID", () => {
    const result = buildLessonDropEvent({
      sections,
      lessonId: "c",
      drop: { targetSectionId: "s1", beforeLessonId: "e" },
      bulkDragIds: new Set(["c"]),
    });
    expect(result).toEqual({
      type: "reorder-lessons",
      sectionId: "s1",
      lessonIds: ["a", "b", "d", "c", "e"],
    });
  });

  it("returns move-lesson-to-section for a single cross-section drop", () => {
    const result = buildLessonDropEvent({
      sections,
      lessonId: "c",
      drop: { targetSectionId: "s2", beforeLessonId: "y" },
      bulkDragIds: null,
    });
    expect(result).toEqual({
      type: "move-lesson-to-section",
      lessonId: "c",
      targetSectionId: "s2",
      beforeLessonId: "y",
    });
  });

  it("returns move-lessons-to-section for a multi-select cross-section drop", () => {
    const result = buildLessonDropEvent({
      sections,
      lessonId: "c",
      drop: { targetSectionId: "s2", beforeLessonId: "y" },
      bulkDragIds: new Set(["a", "c"]),
    });
    // The whole selection moves, ordered by position in the source section.
    expect(result).toEqual({
      type: "move-lessons-to-section",
      lessonIds: ["a", "c"],
      targetSectionId: "s2",
      beforeLessonId: "y",
    });
  });

  it("returns null when source section is not found", () => {
    const result = buildLessonDropEvent({
      sections,
      lessonId: "unknown",
      drop: { targetSectionId: "s1", beforeLessonId: "a" },
      bulkDragIds: null,
    });
    expect(result).toBeNull();
  });

  it("returns null when within-section reorder is a no-op", () => {
    const result = buildLessonDropEvent({
      sections,
      lessonId: "a",
      drop: { targetSectionId: "s1", beforeLessonId: "b" },
      bulkDragIds: null,
    });
    expect(result).toBeNull();
  });

  it("returns null when bulk reorder is a no-op", () => {
    const result = buildLessonDropEvent({
      sections,
      lessonId: "a",
      drop: { targetSectionId: "s1", beforeLessonId: "c" },
      bulkDragIds: new Set(["a", "b"]),
    });
    expect(result).toBeNull();
  });

  it("appends to end of section for single reorder", () => {
    const result = buildLessonDropEvent({
      sections,
      lessonId: "a",
      drop: { targetSectionId: "s1", beforeLessonId: null },
      bulkDragIds: null,
    });
    expect(result).toEqual({
      type: "reorder-lessons",
      sectionId: "s1",
      lessonIds: ["b", "c", "d", "e", "a"],
    });
  });

  it("appends to end of section for bulk reorder", () => {
    const result = buildLessonDropEvent({
      sections,
      lessonId: "a",
      drop: { targetSectionId: "s1", beforeLessonId: null },
      bulkDragIds: new Set(["a", "c"]),
    });
    expect(result).toEqual({
      type: "reorder-lessons",
      sectionId: "s1",
      lessonIds: ["b", "d", "e", "a", "c"],
    });
  });

  it("falls back to single reorder when bulkDragIds is empty", () => {
    const result = buildLessonDropEvent({
      sections,
      lessonId: "c",
      drop: { targetSectionId: "s1", beforeLessonId: "a" },
      bulkDragIds: new Set(),
    });
    expect(result).toEqual({
      type: "reorder-lessons",
      sectionId: "s1",
      lessonIds: ["c", "a", "b", "d", "e"],
    });
  });
});

describe("computeTodoCount", () => {
  it("counts a todo lesson with no videos", () => {
    const sections = [
      makeSection([makeLesson({ authoringStatus: "todo", videos: [] })]),
    ];
    expect(computeTodoCount(sections, noFilters)).toBe(1);
  });

  it("counts a todo lesson that has videos with clips as todo", () => {
    const sections = [
      makeSection([
        makeLesson({
          authoringStatus: "todo",
          videos: [
            { id: "v1", title: "v.mp4", clipCount: 5, totalDuration: 100 },
          ] as Lesson["videos"],
        }),
      ]),
    ];
    expect(computeTodoCount(sections, noFilters)).toBe(1);
  });

  it("does not count a done lesson as todo", () => {
    const sections = [
      makeSection([makeLesson({ authoringStatus: "done", videos: [] })]),
    ];
    expect(computeTodoCount(sections, noFilters)).toBe(0);
  });

  it("counts a lesson with authoringStatus todo", () => {
    const sections = [
      makeSection([
        makeLesson({
          authoringStatus: "todo",
          videos: [],
        }),
      ]),
    ];
    expect(computeTodoCount(sections, noFilters)).toBe(1);
  });

  it("does not count a lesson with null authoringStatus", () => {
    const sections = [
      makeSection([
        makeLesson({
          authoringStatus: null,
          videos: [],
        }),
      ]),
    ];
    expect(computeTodoCount(sections, noFilters)).toBe(0);
  });

  it("counts all todos regardless of priority", () => {
    const sections = [
      makeSection([
        makeLesson({ id: "p1", authoringStatus: "todo", priority: 1 }),
        makeLesson({ id: "p2", authoringStatus: "todo", priority: 2 }),
        makeLesson({ id: "p3", authoringStatus: "todo", priority: 3 }),
      ]),
    ];
    expect(computeTodoCount(sections, noFilters)).toBe(3);
  });

  it("returns zero for empty sections", () => {
    expect(computeTodoCount([], noFilters)).toBe(0);
  });

  it("excludes todo lessons that do not match priority filter", () => {
    const sections = [
      makeSection([
        makeLesson({ id: "p1", authoringStatus: "todo", priority: 1 }),
        makeLesson({ id: "p2", authoringStatus: "todo", priority: 2 }),
      ]),
    ];
    expect(
      computeTodoCount(sections, { ...noFilters, priorityFilter: [1] })
    ).toBe(1);
  });
});

describe("computeCourseStats", () => {
  const video = {
    id: "v1",
    title: "v.mp4",
    clipCount: 5,
    totalDuration: 120,
  } as Lesson["videos"][number];

  it("counts all lessons", () => {
    const sections = [
      makeSection([
        makeLesson({ id: "l1", videos: [video] }),
        makeLesson({ id: "l2", videos: [] }),
      ]),
    ];
    const stats = computeCourseStats(sections);
    expect(stats.totalLessons).toBe(2);
  });

  it("counts lessons with videos", () => {
    const sections = [
      makeSection([
        makeLesson({ id: "l1", videos: [video] }),
        makeLesson({ id: "l2", videos: [] }),
      ]),
    ];
    const stats = computeCourseStats(sections);
    expect(stats.totalLessonsWithVideos).toBe(1);
    expect(stats.totalLessons).toBe(2);
  });

  it("computes percentage correctly", () => {
    const sections = [
      makeSection([
        makeLesson({ id: "l1", videos: [video] }),
        makeLesson({ id: "l2", videos: [] }),
        makeLesson({ id: "l3", videos: [] }),
        makeLesson({ id: "l4", videos: [video] }),
      ]),
    ];
    const stats = computeCourseStats(sections);
    expect(stats.percentageComplete).toBe(50);
  });

  it("returns 0% when no lessons exist", () => {
    const stats = computeCourseStats([]);
    expect(stats.percentageComplete).toBe(0);
    expect(stats.totalLessons).toBe(0);
  });

  it("counts total videos across all lessons", () => {
    const video2 = { ...video, id: "v2" } as Lesson["videos"][number];
    const sections = [
      makeSection([
        makeLesson({ id: "l1", videos: [video, video2] }),
        makeLesson({ id: "l2", videos: [video] }),
      ]),
    ];
    const stats = computeCourseStats(sections);
    expect(stats.totalVideos).toBe(3);
  });

  it("computes total duration across all lessons", () => {
    const longVideo = {
      ...video,
      id: "v2",
      totalDuration: 300,
    } as Lesson["videos"][number];
    const sections = [
      makeSection([
        makeLesson({ id: "l1", videos: [video] }),
        makeLesson({ id: "l2", videos: [longVideo] }),
      ]),
    ];
    const stats = computeCourseStats(sections);
    expect(stats.totalDurationSeconds).toBe(420);
  });

  it("accumulates across multiple sections", () => {
    const sections = [
      makeSection([makeLesson({ id: "l1", videos: [video] })], { id: "s1" }),
      makeSection([makeLesson({ id: "l2", videos: [video] })], { id: "s2" }),
    ];
    const stats = computeCourseStats(sections);
    expect(stats.totalLessons).toBe(2);
    expect(stats.totalLessonsWithVideos).toBe(2);
    expect(stats.totalVideos).toBe(2);
    expect(stats.totalDurationSeconds).toBe(240);
    expect(stats.percentageComplete).toBe(100);
  });

  it("rounds percentage to nearest integer", () => {
    const sections = [
      makeSection([
        makeLesson({ id: "l1", videos: [video] }),
        makeLesson({ id: "l2", videos: [] }),
        makeLesson({ id: "l3", videos: [] }),
      ]),
    ];
    const stats = computeCourseStats(sections);
    expect(stats.percentageComplete).toBe(33);
  });
});
