import { describe, it, expect } from "vitest";
import { matchPaletteShortcut } from "./palette-shortcuts";

/** The bits of a KeyboardEvent the matcher actually reads. */
function key(
  k: string,
  mods: { metaKey?: boolean; ctrlKey?: boolean } = {}
): { key: string; metaKey: boolean; ctrlKey: boolean } {
  return { key: k, metaKey: false, ctrlKey: false, ...mods };
}

describe("Cmd/Ctrl+K", () => {
  it("toggles the palette", () => {
    expect(matchPaletteShortcut(key("k", { metaKey: true }))).toEqual({
      action: "toggle",
    });
    expect(matchPaletteShortcut(key("k", { ctrlKey: true }))).toEqual({
      action: "toggle",
    });
  });
});

describe("Cmd/Ctrl+F", () => {
  it("opens straight onto the diagram search", () => {
    expect(matchPaletteShortcut(key("f", { ctrlKey: true }))).toEqual({
      action: "openAt",
      page: "diagrams",
    });
    expect(matchPaletteShortcut(key("f", { metaKey: true }))).toEqual({
      action: "openAt",
      page: "diagrams",
    });
  });
});

describe("everything else", () => {
  it("ignores the bare letters", () => {
    // tldraw binds bare `k` (laser) and `f` (frame) — an unmodified press is
    // the canvas's, not the palette's.
    expect(matchPaletteShortcut(key("k"))).toBeNull();
    expect(matchPaletteShortcut(key("f"))).toBeNull();
  });

  it("ignores other modified keys", () => {
    expect(matchPaletteShortcut(key("s", { metaKey: true }))).toBeNull();
  });

  it("matches regardless of the shifted casing", () => {
    // Caps lock, or a keyboard layout that reports the shifted letter.
    expect(matchPaletteShortcut(key("F", { metaKey: true }))).toEqual({
      action: "openAt",
      page: "diagrams",
    });
    expect(matchPaletteShortcut(key("K", { ctrlKey: true }))).toEqual({
      action: "toggle",
    });
  });
});
