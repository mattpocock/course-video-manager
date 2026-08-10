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

  it("returns green ring for add action on drag target", () => {
    expect(
      computeDragClassName({
        isDragSource: false,
        isDragTarget: true,
        isExistingDependency: false,
        dropAction: "add",
      })
    ).toBe("ring-2 ring-green-500/50 bg-green-500/5");
  });

  it("returns amber ring for remove action on drag target", () => {
    expect(
      computeDragClassName({
        isDragSource: false,
        isDragTarget: true,
        isExistingDependency: true,
        dropAction: "remove",
      })
    ).toBe("ring-2 ring-amber-500/50 bg-amber-500/5");
  });

  it("returns red ring for noop action on drag target", () => {
    expect(
      computeDragClassName({
        isDragSource: false,
        isDragTarget: true,
        isExistingDependency: false,
        dropAction: "noop",
      })
    ).toBe("ring-2 ring-red-500/50 bg-red-500/5");
  });

  it("returns slate ring for existing dependency during drag", () => {
    expect(
      computeDragClassName({
        isDragSource: false,
        isDragTarget: false,
        isExistingDependency: true,
        dropAction: null,
      })
    ).toBe("ring-2 ring-slate-400/50 bg-slate-400/5");
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
