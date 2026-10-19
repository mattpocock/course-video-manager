import { describe, it, expect } from "vitest";
import { computeDragClassName } from "./use-lesson-dependency-drag";

describe("computeDragClassName", () => {
  it("returns opacity-60 for drag source", () => {
    expect(
      computeDragClassName({
        isDragSource: true,
        isDragTarget: false,
        isExistingDependency: false,
        dropAction: null,
      })
    ).toBe("opacity-60");
  });

  it("returns empty string when no drag is active", () => {
    expect(
      computeDragClassName({
        isDragSource: false,
        isDragTarget: false,
        isExistingDependency: false,
        dropAction: null,
      })
    ).toBe("");
  });

  it("drag target styling takes precedence over existing dependency", () => {
    expect(
      computeDragClassName({
        isDragSource: false,
        isDragTarget: true,
        isExistingDependency: true,
        dropAction: "remove",
      })
    ).toBe("ring-2 ring-amber-500/50 bg-amber-500/5");
  });

  it("drag source styling takes precedence over existing dependency", () => {
    expect(
      computeDragClassName({
        isDragSource: true,
        isDragTarget: false,
        isExistingDependency: true,
        dropAction: null,
      })
    ).toBe("opacity-60");
  });
});
