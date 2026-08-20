import { describe, it, expect } from "vitest";
import { isRecentreShortcut } from "./use-recentre-diagram-shortcut";

/** The bits of a KeyboardEvent the matcher actually reads. */
function key(
  k: string,
  mods: { metaKey?: boolean; ctrlKey?: boolean } = {}
): { key: string; metaKey: boolean; ctrlKey: boolean } {
  return { key: k, metaKey: false, ctrlKey: false, ...mods };
}

describe("Cmd/Ctrl+0", () => {
  it("matches with either modifier", () => {
    expect(isRecentreShortcut(key("0", { metaKey: true }))).toBe(true);
    expect(isRecentreShortcut(key("0", { ctrlKey: true }))).toBe(true);
  });

  it("ignores a bare 0 — that's just a digit", () => {
    expect(isRecentreShortcut(key("0"))).toBe(false);
  });

  it("ignores other modified keys", () => {
    expect(isRecentreShortcut(key("1", { metaKey: true }))).toBe(false);
  });
});
