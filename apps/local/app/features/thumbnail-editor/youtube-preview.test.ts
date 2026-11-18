import { describe, expect, it } from "vitest";
import { coverCrop, previewCanvasSize } from "./youtube-preview";

describe("coverCrop", () => {
  it("takes the whole image when it already has the box's shape", () => {
    expect(coverCrop(1280, 720, 640, 360)).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    });
  });

  it("crops a wider image evenly from both sides", () => {
    expect(coverCrop(2000, 720, 1280, 720)).toEqual({
      x: 360,
      y: 0,
      width: 1280,
      height: 720,
    });
  });

  it("crops a taller image evenly from top and bottom", () => {
    expect(coverCrop(1280, 1000, 1280, 720)).toEqual({
      x: 0,
      y: 140,
      width: 1280,
      height: 720,
    });
  });
});

describe("previewCanvasSize", () => {
  it("is a whole number of device pixels at a fractional display scale", () => {
    // 125%: 246 × 138 CSS px is 307.5 × 172.5 device px.
    expect(previewCanvasSize(246, 138, 1.25)).toEqual({
      deviceWidth: 308,
      deviceHeight: 173,
      cssWidth: 308 / 1.25,
      cssHeight: 173 / 1.25,
    });
  });
});
