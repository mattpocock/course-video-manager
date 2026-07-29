import { describe, it, expect } from "vitest";
import { ICON_NAMES, getIconNode, searchIconNames } from "../index";
import { BACKFILL_NAMES } from "../generator";

describe("the frozen table", () => {
  it("carries the whole lucide set", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(1600);
  });

  it("returns raw lucide primitives, not transpiled geometry", () => {
    const node = getIconNode("circle");
    expect(node).toBeDefined();
    for (const [tag, attrs] of node!) {
      expect([
        "path",
        "circle",
        "rect",
        "line",
        "polyline",
        "polygon",
        "ellipse",
      ]).toContain(tag);
      // React `key` attributes are the one thing stripped.
      expect(attrs).not.toHaveProperty("key");
    }
  });

  it("uses only the seven lucide primitives across the whole set", () => {
    const tags = new Set<string>();
    for (const name of ICON_NAMES) {
      for (const [tag] of getIconNode(name)!) tags.add(tag);
    }
    expect([...tags].sort()).toEqual([
      "circle",
      "ellipse",
      "line",
      "path",
      "polygon",
      "polyline",
      "rect",
    ]);
  });

  it("keeps the 19 permanently-removed names lucide will never ship again", () => {
    for (const name of BACKFILL_NAMES) {
      expect(getIconNode(name), name).toBeDefined();
    }
  });

  it("keeps save-off untouched, out-of-viewBox geometry and all", () => {
    // Its glyph reaches x = 33.6 on a 24-unit grid — 40% past the right edge —
    // in every lucide version. Excluding it would put a hand-curated hole in an
    // append-only table; normalising it would mean the vendored data no longer
    // matches lucide. It ships as-is, and the shape's bounds come from the
    // fixed 24x24 viewBox rather than from parsed geometry.
    const node = getIconNode("save-off");
    expect(node).toBeDefined();
    expect(JSON.stringify(node)).toContain("M29.5 11.5s5 5 4 5");
  });

  it("returns undefined for an unknown name rather than throwing", () => {
    expect(getIconNode("definitely-not-an-icon")).toBeUndefined();
  });
});

describe("searchIconNames", () => {
  it("finds an icon by a prefix of its name", () => {
    expect(searchIconNames("databas")).toContain("database");
  });

  it("finds an icon by a word in the middle of its name", () => {
    expect(searchIconNames("branch")).toContain("git-branch");
  });

  it("honours lucide's aliases as synonyms", () => {
    // "grab" is not a substring of any part of "hand-grab" that a prefix search
    // would reach first; it is lucide's own alias for it.
    expect(searchIconNames("grab")).toContain("hand-grab");
  });

  it("never returns an alias as a name — synonyms only widen matching", () => {
    const names = new Set(ICON_NAMES);
    for (const hit of searchIconNames("grab")) {
      expect(names.has(hit), hit).toBe(true);
    }
  });

  it("caps its result count", () => {
    expect(searchIconNames("a", { limit: 12 })).toHaveLength(12);
  });

  it("returns the head of the set for an empty query", () => {
    expect(searchIconNames("", { limit: 3 })).toEqual(ICON_NAMES.slice(0, 3));
  });
});
