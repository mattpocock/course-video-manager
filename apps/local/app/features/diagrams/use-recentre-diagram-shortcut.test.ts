import { describe, it, expect } from "vitest";
import { isRecentreShortcut } from "./use-recentre-diagram-shortcut";

/** The bits of a KeyboardEvent the matcher actually reads. */
function key(
  k: string,
  mods: { metaKey?: boolean; ctrlKey?: boolean } = {}
): { key: string; metaKey: boolean; ctrlKey: boolean } {
  return { key: k, metaKey: false, ctrlKey: false, ...mods };
}

describe("Cmd/Ctrl+Home", () => {
  it("matches with either modifier", () => {
    expect(isRecentreShortcut(key("Home", { metaKey: true }))).toBe(true);
    expect(isRecentreShortcut(key("Home", { ctrlKey: true }))).toBe(true);
  });

  it("ignores a bare Home — that's the page's own scroll-to-top", () => {
    expect(isRecentreShortcut(key("Home"))).toBe(false);
  });

  it("does not match Cmd/Ctrl+0 — the browser's own reserved reset-zoom shortcut", () => {
    // The whole point of not using it: preventDefault() can't stop the
    // browser's handling of it, so binding to it would be a dead keypress.
    expect(isRecentreShortcut(key("0", { metaKey: true }))).toBe(false);
    expect(isRecentreShortcut(key("0", { ctrlKey: true }))).toBe(false);
  });

  it("ignores other modified keys", () => {
    expect(isRecentreShortcut(key("End", { metaKey: true }))).toBe(false);
  });
});
