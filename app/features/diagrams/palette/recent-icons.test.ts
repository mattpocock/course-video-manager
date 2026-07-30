import { describe, it, expect } from "vitest";
import {
  RECENT_ICONS_LIMIT,
  parseRecentIcons,
  pushRecentIcon,
} from "./recent-icons";

describe("pushRecentIcon", () => {
  it("puts the icon just used at the front", () => {
    expect(pushRecentIcon(["circle", "square"], "atom")).toEqual([
      "atom",
      "circle",
      "square",
    ]);
  });

  it("moves a repeat use back to the front rather than duplicating it", () => {
    // A duplicate would spend two of the grid's leading cells on one icon.
    expect(pushRecentIcon(["circle", "square", "atom"], "atom")).toEqual([
      "atom",
      "circle",
      "square",
    ]);
  });

  it("drops the least recent once the list is full", () => {
    const full = Array.from({ length: RECENT_ICONS_LIMIT }, (_, i) => `i${i}`);
    const next = pushRecentIcon(full, "atom");
    expect(next).toHaveLength(RECENT_ICONS_LIMIT);
    expect(next[0]).toBe("atom");
    expect(next).not.toContain(`i${RECENT_ICONS_LIMIT - 1}`);
  });
});

describe("parseRecentIcons", () => {
  it("reads back what was stored", () => {
    expect(parseRecentIcons(JSON.stringify(["atom", "circle"]))).toEqual([
      "atom",
      "circle",
    ]);
  });

  it("treats a missing, unparseable or non-array value as no history", () => {
    // The list is a convenience, so nothing about it may throw on open.
    expect(parseRecentIcons(null)).toEqual([]);
    expect(parseRecentIcons("")).toEqual([]);
    expect(parseRecentIcons("{oops")).toEqual([]);
    expect(parseRecentIcons(JSON.stringify({ atom: 1 }))).toEqual([]);
  });

  it("keeps only strings, and only as many as the list holds", () => {
    expect(
      parseRecentIcons(JSON.stringify(["atom", 7, null, "circle"]))
    ).toEqual(["atom", "circle"]);
    const overlong = Array.from(
      { length: RECENT_ICONS_LIMIT + 5 },
      (_, i) => `i${i}`
    );
    expect(parseRecentIcons(JSON.stringify(overlong))).toHaveLength(
      RECENT_ICONS_LIMIT
    );
  });
});
