import { describe, it, expect } from "vitest";
import { nextGridIndex, type GridKey } from "./grid-nav";

// A 10-column grid of 25 cells: rows 0-9, 10-19, 20-24 (a ragged last row).
const GRID = { count: 25, columns: 10 };
const at = (current: number, key: GridKey, grid = GRID) =>
  nextGridIndex({ ...grid, current, key });

describe("horizontal movement", () => {
  it("moves by one", () => {
    expect(at(4, "ArrowRight")).toBe(5);
    expect(at(4, "ArrowLeft")).toBe(3);
  });

  it("crosses a row boundary rather than wrapping in place", () => {
    expect(at(9, "ArrowRight")).toBe(10);
    expect(at(10, "ArrowLeft")).toBe(9);
  });

  it("stops at both ends", () => {
    expect(at(0, "ArrowLeft")).toBe(0);
    expect(at(24, "ArrowRight")).toBe(24);
  });
});

describe("vertical movement", () => {
  it("moves by a whole row", () => {
    expect(at(3, "ArrowDown")).toBe(13);
    expect(at(13, "ArrowUp")).toBe(3);
  });

  it("lands on the last cell when the row below is short", () => {
    // Holding Down must always terminate somewhere sensible.
    expect(at(19, "ArrowDown")).toBe(24);
    expect(at(24, "ArrowDown")).toBe(24);
  });

  it("falls through on row 0, so focus returns to the input", () => {
    expect(at(0, "ArrowUp")).toBe("fall-through");
    expect(at(9, "ArrowUp")).toBe("fall-through");
    expect(at(10, "ArrowUp")).toBe(0);
  });
});

describe("Home and End", () => {
  it("jump to the first and last cell", () => {
    expect(at(13, "Home")).toBe(0);
    expect(at(13, "End")).toBe(24);
  });
});

describe("other column counts", () => {
  // The hook is used at 10 columns for icons, 4 for components, 3 for diagrams.
  it("works at 4 columns", () => {
    const grid = { count: 14, columns: 4 };
    expect(at(1, "ArrowDown", grid)).toBe(5);
    expect(at(5, "ArrowUp", grid)).toBe(1);
    expect(at(2, "ArrowUp", grid)).toBe("fall-through");
    expect(at(12, "ArrowDown", grid)).toBe(13);
  });

  it("works at 3 columns", () => {
    const grid = { count: 7, columns: 3 };
    expect(at(0, "ArrowDown", grid)).toBe(3);
    expect(at(4, "ArrowDown", grid)).toBe(6);
    expect(at(6, "ArrowUp", grid)).toBe(3);
  });

  it("degenerates to a list at 1 column", () => {
    const grid = { count: 5, columns: 1 };
    expect(at(2, "ArrowDown", grid)).toBe(3);
    expect(at(2, "ArrowUp", grid)).toBe(1);
    expect(at(0, "ArrowUp", grid)).toBe("fall-through");
  });
});

describe("edge cases", () => {
  it("falls through when the grid is empty", () => {
    expect(at(0, "ArrowDown", { count: 0, columns: 10 })).toBe("fall-through");
  });

  it("treats a missing current selection as the first cell", () => {
    // cmdk reports -1 when nothing is highlighted yet.
    expect(at(-1, "ArrowRight")).toBe(1);
    expect(at(-1, "ArrowUp")).toBe("fall-through");
  });

  it("clamps a current index past the end", () => {
    expect(at(99, "ArrowLeft")).toBe(23);
  });
});
