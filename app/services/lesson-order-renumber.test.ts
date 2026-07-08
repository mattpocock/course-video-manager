import { describe, it, expect } from "vitest";
import {
  computeDenseLessonOrders,
  type LessonForRenumber,
} from "@/services/lesson-order-renumber";

describe("computeDenseLessonOrders", () => {
  it("resolves the resync order collision back to the dragged lesson's slot", () => {
    // Reproduces the 06-steering corruption. Before resync the dragged lesson sat
    // between r4 and r5 on a shifted integer (r5/r6 had been bumped to 6/7);
    // resync then re-derived r5/r6 from their path numbers (5/6), dropping r5
    // onto the dragged lesson slot of 5.
    const preResync = new Map<string, number>([
      ["r1", 1],
      ["r2", 2],
      ["r3", 3],
      ["r4", 4],
      ["dragged", 5],
      ["r5", 6],
      ["r6", 7],
    ]);

    const postResync: LessonForRenumber[] = [
      { id: "r1", order: 1 },
      { id: "r2", order: 2 },
      { id: "r3", order: 3 },
      { id: "r4", order: 4 },
      { id: "r5", order: 5 }, // collides with dragged lesson
      { id: "dragged", order: 5 },
      { id: "r6", order: 6 },
    ];

    const result = computeDenseLessonOrders(postResync, preResync);

    // Dense, collision-free, 0..n-1
    const orders = result.map((r) => r.order);
    expect(orders).toEqual([0, 1, 2, 3, 4, 5, 6]);

    // Dragged lesson preserved between r4 and r5, exactly where the user dragged it.
    const byId = new Map(result.map((r) => [r.id, r.order]));
    expect(byId.get("r4")).toBe(3);
    expect(byId.get("dragged")).toBe(4);
    expect(byId.get("r5")).toBe(5);
    expect(byId.get("r6")).toBe(6);
  });

  it("handles two dragged lessons colliding with consecutive siblings (10-docs shape)", () => {
    const preResync = new Map<string, number>([
      ["docRot", 0],
      ["l1", 1],
      ["l2", 2],
      ["gA", 3], // inserted after l2, bumping l3 to 4
      ["l3", 4],
      ["gB", 5], // inserted after l3, bumping l4 to 6
      ["l4", 6],
    ]);

    const postResync: LessonForRenumber[] = [
      { id: "docRot", order: 0 },
      { id: "l1", order: 1 },
      { id: "l2", order: 2 },
      { id: "gA", order: 3 }, // resync put l3 back to 3
      { id: "l3", order: 3 },
      { id: "gB", order: 5 },
      { id: "l4", order: 4 }, // resync put l4 back to 4
    ];

    const result = computeDenseLessonOrders(postResync, preResync);
    const byId = new Map(result.map((r) => [r.id, r.order]));

    expect(result.map((r) => r.order).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    // docRot, l1, l2, gA, l3, l4, gB
    expect(byId.get("docRot")).toBe(0);
    expect(byId.get("l1")).toBe(1);
    expect(byId.get("l2")).toBe(2);
    expect(byId.get("gA")).toBe(3);
    expect(byId.get("l3")).toBe(4);
    expect(byId.get("l4")).toBe(5);
    expect(byId.get("gB")).toBe(6);
  });

  it("is a no-op for an already-dense, collision-free section", () => {
    const pre = new Map<string, number>([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
    const lessons: LessonForRenumber[] = [
      { id: "a", order: 0 },
      { id: "b", order: 1 },
      { id: "c", order: 2 },
    ];
    expect(computeDenseLessonOrders(lessons, pre)).toEqual([
      { id: "a", order: 0 },
      { id: "b", order: 1 },
      { id: "c", order: 2 },
    ]);
  });

  it("compacts sparse orders left by an out-moved lesson", () => {
    const pre = new Map<string, number>([
      ["a", 0],
      ["b", 2],
      ["c", 5],
    ]);
    const lessons: LessonForRenumber[] = [
      { id: "a", order: 0 },
      { id: "b", order: 2 },
      { id: "c", order: 5 },
    ];
    expect(computeDenseLessonOrders(lessons, pre)).toEqual([
      { id: "a", order: 0 },
      { id: "b", order: 1 },
      { id: "c", order: 2 },
    ]);
  });

  it("places a newly-added lesson (absent from the snapshot) by its order", () => {
    const pre = new Map<string, number>([
      ["a", 0],
      ["c", 1],
    ]);
    const lessons: LessonForRenumber[] = [
      { id: "a", order: 0 },
      { id: "new", order: 1 }, // added on disk between a and c
      { id: "c", order: 2 },
    ];
    expect(computeDenseLessonOrders(lessons, pre)).toEqual([
      { id: "a", order: 0 },
      { id: "new", order: 1 },
      { id: "c", order: 2 },
    ]);
  });
});
