import { describe, expect, it } from "vitest";
import {
  areAllCollapsed,
  collapseIds,
  expandIds,
  parseCollapsedIds,
  toggleId,
} from "./collapsed-ids";

// React only re-renders on a fresh reference, so every operation has to build a
// new set rather than fold the caller's one in place.
describe("collapse operations", () => {
  it("leave the set they were given untouched", () => {
    const previous = new Set(["a", "b"]);

    toggleId(previous, "a");
    collapseIds(previous, ["c"]);
    expandIds(previous, ["b"]);

    expect([...previous]).toEqual(["a", "b"]);
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

  it("ignores collapsed ids that are not on the list", () => {
    expect(areAllCollapsed(new Set(["a", "gone"]), ["a"])).toBe(true);
  });
});

describe("parseCollapsedIds", () => {
  it("restores the ids that were persisted", () => {
    expect([...parseCollapsedIds('["a","b"]')]).toEqual(["a", "b"]);
  });

  it("treats a missing or empty entry as nothing collapsed", () => {
    expect([...parseCollapsedIds(null)]).toEqual([]);
    expect([...parseCollapsedIds("")]).toEqual([]);
  });

  it("treats unparseable JSON as nothing collapsed", () => {
    expect([...parseCollapsedIds("not json")]).toEqual([]);
  });

  // A bare string is iterable, so handing it to `new Set` would silently fold
  // one id per character.
  it("treats a non-array payload as nothing collapsed", () => {
    expect([...parseCollapsedIds('"abc"')]).toEqual([]);
    expect([...parseCollapsedIds('{"a":true}')]).toEqual([]);
    expect([...parseCollapsedIds("42")]).toEqual([]);
  });

  it("drops non-string entries rather than collapsing on them", () => {
    expect([...parseCollapsedIds('["a",null,7,{},"b"]')]).toEqual(["a", "b"]);
  });
});
