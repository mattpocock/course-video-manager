import { describe, it, expect } from "vitest";
import { computeDropResult, wouldCreateCycle } from "./dependency-drag";

describe("computeDropResult", () => {
  it("returns noop for self-reference", () => {
    expect(computeDropResult("A", "A", [], {})).toEqual({
      action: "noop",
      reason: "self",
    });
  });

  it("removes dependency when target is already a dependency", () => {
    expect(computeDropResult("A", "B", ["B", "C"], {})).toEqual({
      action: "remove",
      dependencies: ["C"],
    });
  });

  it("adds dependency when target is not yet a dependency", () => {
    expect(computeDropResult("A", "B", ["C"], {})).toEqual({
      action: "add",
      dependencies: ["C", "B"],
    });
  });

  it("adds dependency with empty initial dependencies", () => {
    expect(computeDropResult("A", "B", [], {})).toEqual({
      action: "add",
      dependencies: ["B"],
    });
  });

  it("returns noop when adding would create a direct cycle", () => {
    expect(computeDropResult("A", "B", [], { B: ["A"] })).toEqual({
      action: "noop",
      reason: "cycle",
    });
  });

  it("returns noop when adding would create an indirect cycle", () => {
    expect(computeDropResult("A", "B", [], { B: ["C"], C: ["A"] })).toEqual({
      action: "noop",
      reason: "cycle",
    });
  });

  it("allows removing a dependency that participates in a cycle", () => {
    expect(computeDropResult("A", "B", ["B"], { B: ["A"] })).toEqual({
      action: "remove",
      dependencies: [],
    });
  });

  it("removes all occurrences when dependency appears multiple times", () => {
    expect(computeDropResult("A", "B", ["B", "C", "B"], {})).toEqual({
      action: "remove",
      dependencies: ["C"],
    });
  });

  it("adds when target has deps but none lead back to source", () => {
    expect(
      computeDropResult("A", "B", [], { B: ["C", "D"], C: ["E"] })
    ).toEqual({
      action: "add",
      dependencies: ["B"],
    });
  });
});

describe("wouldCreateCycle", () => {
  it("returns false when no path exists", () => {
    expect(wouldCreateCycle("A", "B", {})).toBe(false);
  });

  it("detects direct cycle", () => {
    expect(wouldCreateCycle("A", "B", { B: ["A"] })).toBe(true);
  });

  it("detects indirect cycle", () => {
    expect(wouldCreateCycle("A", "B", { B: ["C"], C: ["A"] })).toBe(true);
  });

  it("returns false for non-cyclic graph", () => {
    expect(wouldCreateCycle("A", "B", { B: ["C"], C: ["D"] })).toBe(false);
  });

  it("handles missing entries in map", () => {
    expect(wouldCreateCycle("A", "B", { B: ["X"] })).toBe(false);
  });
});
