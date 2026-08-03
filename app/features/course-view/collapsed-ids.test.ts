import { describe, expect, it } from "vitest";
import {
  areAllCollapsed,
  collapseIds,
  expandIds,
  toggleId,
} from "./collapsed-ids";

describe("toggleId", () => {
  it("collapses an id that is currently expanded", () => {
    expect([...toggleId(new Set(), "a")]).toEqual(["a"]);
  });

  it("expands an id that is currently collapsed", () => {
    expect([...toggleId(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });

  it("leaves the previous set untouched", () => {
    const previous = new Set(["a"]);
    toggleId(previous, "b");
    expect([...previous]).toEqual(["a"]);
  });
});

describe("collapseIds", () => {
  it("collapses every given id, keeping ones already collapsed", () => {
    expect([...collapseIds(new Set(["a"]), ["b", "c"])].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("expandIds", () => {
  it("expands every given id and leaves the rest collapsed", () => {
    expect([...expandIds(new Set(["a", "b", "c"]), ["a", "c"])]).toEqual(["b"]);
  });
});

describe("areAllCollapsed", () => {
  it("is true when every id is collapsed", () => {
    expect(areAllCollapsed(new Set(["a", "b"]), ["a", "b"])).toBe(true);
  });

  it("is false when one id is still expanded", () => {
    expect(areAllCollapsed(new Set(["a"]), ["a", "b"])).toBe(false);
  });

  // Nothing to collapse must read as "expanded", so the toggle-all control
  // offers "Collapse all" rather than a no-op "Expand all".
  it("is false when there are no ids at all", () => {
    expect(areAllCollapsed(new Set(), [])).toBe(false);
  });
});
