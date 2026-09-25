import { describe, expect, it } from "vitest";
import {
  moveSelection,
  resolveSelection,
  selectEdge,
} from "./animatic-selection";

describe("resolveSelection", () => {
  it("follows the playhead while nothing is selected", () => {
    expect(resolveSelection(null, 4)).toBe(4);
  });

  it("prefers the author's own choice over the playhead", () => {
    expect(resolveSelection(1, 4)).toBe(1);
  });

  it("reports -1 for an empty Animatic", () => {
    expect(resolveSelection(null, -1)).toBe(-1);
  });
});

describe("moveSelection", () => {
  it("adopts the playhead's segment on the first press, without moving", () => {
    expect(
      moveSelection({ selection: null, activeIndex: 7, delta: 1, count: 20 })
    ).toBe(7);
    expect(
      moveSelection({ selection: null, activeIndex: 7, delta: -1, count: 20 })
    ).toBe(7);
  });

  it("starts at the first segment when there is no playhead yet", () => {
    expect(
      moveSelection({ selection: null, activeIndex: -1, delta: 1, count: 20 })
    ).toBe(0);
  });

  it("moves one segment at a time once a selection exists", () => {
    expect(
      moveSelection({ selection: 7, activeIndex: 0, delta: 1, count: 20 })
    ).toBe(8);
    expect(
      moveSelection({ selection: 7, activeIndex: 0, delta: -1, count: 20 })
    ).toBe(6);
  });

  it("holds at both ends rather than wrapping", () => {
    expect(
      moveSelection({ selection: 0, activeIndex: 0, delta: -1, count: 20 })
    ).toBe(0);
    expect(
      moveSelection({ selection: 19, activeIndex: 0, delta: 1, count: 20 })
    ).toBe(19);
  });

  it("has nothing to select in an empty Animatic", () => {
    expect(
      moveSelection({ selection: null, activeIndex: -1, delta: 1, count: 0 })
    ).toBe(null);
  });
});

/**
 * Rows 1 and 2 are behind a folded Chapter; rows 0, 3 and 4 are on screen. The
 * set is what `hiddenRowIndices` hands over — see `animatic-collapse.test.ts`.
 */
const folded = new Set([1, 2]);

describe("moveSelection over a folded Chapter", () => {
  it("steps over the hidden rows on the way down", () => {
    expect(
      moveSelection({
        selection: 0,
        activeIndex: 0,
        delta: 1,
        count: 5,
        hiddenIndices: folded,
      })
    ).toBe(3);
  });

  it("steps over them on the way up as well", () => {
    expect(
      moveSelection({
        selection: 3,
        activeIndex: 3,
        delta: -1,
        count: 5,
        hiddenIndices: folded,
      })
    ).toBe(0);
  });

  it("holds where it is when every row beyond is hidden", () => {
    // Everything folded away below row 0: there is nowhere on screen to go.
    expect(
      moveSelection({
        selection: 0,
        activeIndex: 0,
        delta: 1,
        count: 5,
        hiddenIndices: new Set([1, 2, 3, 4]),
      })
    ).toBe(0);
  });

  it("moves exactly as before when an empty set says nothing is folded", () => {
    expect(
      moveSelection({
        selection: 0,
        activeIndex: 0,
        delta: 1,
        count: 5,
        hiddenIndices: new Set(),
      })
    ).toBe(1);
  });
});

describe("selectEdge", () => {
  it("selects the first and the last row while nothing is folded", () => {
    expect(selectEdge({ edge: "first", count: 5 })).toBe(0);
    expect(selectEdge({ edge: "last", count: 5 })).toBe(4);
  });

  it("selects the last row on screen rather than one behind a fold", () => {
    expect(
      selectEdge({ edge: "last", count: 5, hiddenIndices: new Set([3, 4]) })
    ).toBe(2);
  });

  it("selects the first row on screen rather than one behind a fold", () => {
    expect(
      selectEdge({ edge: "first", count: 5, hiddenIndices: new Set([0, 1]) })
    ).toBe(2);
  });

  it("has nothing to select with every row behind a fold", () => {
    expect(
      selectEdge({
        edge: "first",
        count: 3,
        hiddenIndices: new Set([0, 1, 2]),
      })
    ).toBe(null);
  });

  it("has nothing to select in an empty Animatic", () => {
    expect(selectEdge({ edge: "last", count: 0 })).toBe(null);
  });
});
