import { describe, it, expect } from "vitest";
import { getRuleOfThirdsLines } from "./rule-of-thirds";

describe("getRuleOfThirdsLines", () => {
  it("returns 4 lines dividing the area into thirds", () => {
    const lines = getRuleOfThirdsLines(1280, 720);

    expect(lines).toHaveLength(4);
  });

  it("places vertical lines at 1/3 and 2/3 of width", () => {
    const lines = getRuleOfThirdsLines(1280, 720);
    const vertical = lines.filter((l) => l.x1 === l.x2);

    expect(vertical).toHaveLength(2);
    expect(vertical[0]).toEqual({
      x1: 1280 / 3,
      y1: 0,
      x2: 1280 / 3,
      y2: 720,
    });
    expect(vertical[1]).toEqual({
      x1: (1280 * 2) / 3,
      y1: 0,
      x2: (1280 * 2) / 3,
      y2: 720,
    });
  });

  it("places horizontal lines at 1/3 and 2/3 of height", () => {
    const lines = getRuleOfThirdsLines(1280, 720);
    const horizontal = lines.filter((l) => l.y1 === l.y2);

    expect(horizontal).toHaveLength(2);
    expect(horizontal[0]).toEqual({
      x1: 0,
      y1: 720 / 3,
      x2: 1280,
      y2: 720 / 3,
    });
    expect(horizontal[1]).toEqual({
      x1: 0,
      y1: (720 * 2) / 3,
      x2: 1280,
      y2: (720 * 2) / 3,
    });
  });
});
