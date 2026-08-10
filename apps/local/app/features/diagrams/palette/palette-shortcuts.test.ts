import { describe, it, expect } from "vitest";
import { paletteKeyCommand } from "./palette-shortcuts";

/** The bits of a KeyboardEvent the matcher actually reads. */
function key(
  k: string,
  mods: { metaKey?: boolean; ctrlKey?: boolean } = {}
): { key: string; metaKey: boolean; ctrlKey: boolean } {
  return { key: k, metaKey: false, ctrlKey: false, ...mods };
}

const CLOSED = { isOpen: false };
const OPEN = { isOpen: true };

describe("Cmd/Ctrl+K", () => {
  it("summons the root list, and dismisses what it summoned", () => {
    expect(paletteKeyCommand(key("k", { metaKey: true }), CLOSED)).toEqual({
      command: "open",
      page: null,
    });
    expect(paletteKeyCommand(key("k", { ctrlKey: true }), OPEN)).toEqual({
      command: "close",
    });
  });
});

describe("Cmd/Ctrl+F", () => {
  it("summons the palette onto the diagram search", () => {
    expect(paletteKeyCommand(key("f", { ctrlKey: true }), CLOSED)).toEqual({
      command: "open",
      page: "diagrams",
    });
    expect(paletteKeyCommand(key("f", { metaKey: true }), CLOSED)).toEqual({
      command: "open",
      page: "diagrams",
    });
  });

  it("walks an already-open palette to the search rather than dismissing it", () => {
    // The sequence that used to die: Ctrl+F opens onto the search, Esc backs
    // out to the root, Ctrl+F again. The palette never left, so nothing about
    // "which page was asked for" changed — and a second press still has to
    // land back on the search.
    expect(paletteKeyCommand(key("f", { ctrlKey: true }), OPEN)).toEqual({
      command: "open",
      page: "diagrams",
    });
  });
});

describe("everything else", () => {
  it("ignores the bare letters", () => {
    // tldraw binds bare `k` (laser) and `f` (frame) — an unmodified press is
    // the canvas's, not the palette's.
    expect(paletteKeyCommand(key("k"), CLOSED)).toBeNull();
    expect(paletteKeyCommand(key("f"), OPEN)).toBeNull();
  });

  it("ignores other modified keys", () => {
    expect(paletteKeyCommand(key("s", { metaKey: true }), CLOSED)).toBeNull();
  });

  it("matches regardless of the shifted casing", () => {
    // Caps lock, or a keyboard layout that reports the shifted letter.
    expect(paletteKeyCommand(key("F", { metaKey: true }), CLOSED)).toEqual({
      command: "open",
      page: "diagrams",
    });
    expect(paletteKeyCommand(key("K", { ctrlKey: true }), CLOSED)).toEqual({
      command: "open",
      page: null,
    });
  });
});
