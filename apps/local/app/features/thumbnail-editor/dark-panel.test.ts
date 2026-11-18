import { describe, expect, it } from "vitest";
import { DARK_PANEL_PADDING, darkPanelSpan } from "./dark-panel";

const box = (minX: number, maxX: number, minY = 100, maxY = 200) => ({
  minX,
  maxX,
  minY,
  maxY,
});

describe("darkPanelSpan", () => {
  it("spans the drawing in the frame, plus padding", () => {
    expect(darkPanelSpan([box(100, 300), box(250, 500)])).toEqual({
      x: 100 - DARK_PANEL_PADDING,
      width: 500 - 100 + 2 * DARK_PANEL_PADDING,
    });
  });

  it("is not widened by a shape parked off the frame", () => {
    expect(
      darkPanelSpan([box(100, 300), box(1400, 1600), box(400, 500, -300, -50)])
    ).toEqual({
      x: 100 - DARK_PANEL_PADDING,
      width: 200 + 2 * DARK_PANEL_PADDING,
    });
  });

  it("stops at the frame edge for a shape straddling it", () => {
    expect(darkPanelSpan([box(-200, 100), box(1100, 1500)])).toEqual({
      x: 0,
      width: 1280,
    });
  });

  it("is absent when nothing is in the frame", () => {
    expect(darkPanelSpan([])).toBeNull();
    expect(darkPanelSpan([box(-500, -100), box(1280, 1400)])).toBeNull();
  });
});
