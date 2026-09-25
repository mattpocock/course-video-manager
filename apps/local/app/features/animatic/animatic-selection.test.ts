import { describe, expect, it } from "vitest";
import { moveSelection, resolveSelection } from "./animatic-selection";

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
