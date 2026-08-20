import { describe, it, expect } from "vitest";
import {
  getRightOffscreenWidth,
  getSafeAreaInsets,
} from "./diagram-centering-settings";

describe("getRightOffscreenWidth", () => {
  it("is zero when the canvas already spans the whole window", () => {
    expect(getRightOffscreenWidth({ x: 0, w: 1000 }, 1000)).toBe(0);
  });

  it("is the gap between the canvas's right edge and the window's", () => {
    // A 256px sidebar eating the right of a 1000px window.
    expect(getRightOffscreenWidth({ x: 0, w: 744 }, 1000)).toBe(256);
  });

  it("accounts for the canvas not starting at the window's left edge either", () => {
    expect(getRightOffscreenWidth({ x: 50, w: 700 }, 1000)).toBe(250);
  });

  it("never goes negative", () => {
    // A canvas that (somehow) already exceeds the window is fully on-screen.
    expect(getRightOffscreenWidth({ x: 0, w: 1200 }, 1000)).toBe(0);
  });
});

describe("getSafeAreaInsets", () => {
  it("defaults rightOffscreenWidth to zero — the pre-sidebar-aware behaviour", () => {
    expect(
      getSafeAreaInsets({ faceCamWidth: 200, paddingX: 10, paddingY: 5 })
    ).toEqual({ left: 10, right: 210, top: 5, bottom: 5 });
  });

  it("subtracts what the sidebar already covers from the reserved strip", () => {
    expect(
      getSafeAreaInsets({ faceCamWidth: 200, paddingX: 10, paddingY: 5 }, 150)
    ).toEqual({ left: 10, right: 60, top: 5, bottom: 5 });
  });

  it("floors the strip at zero once the sidebar covers all of it — padding still applies", () => {
    expect(
      getSafeAreaInsets({ faceCamWidth: 200, paddingX: 10, paddingY: 5 }, 500)
    ).toEqual({ left: 10, right: 10, top: 5, bottom: 5 });
  });

  it("left/top/bottom are untouched by rightOffscreenWidth — only the strip is pinned to the window", () => {
    const noSidebar = getSafeAreaInsets({
      faceCamWidth: 0,
      paddingX: 10,
      paddingY: 5,
    });
    const withSidebar = getSafeAreaInsets(
      { faceCamWidth: 0, paddingX: 10, paddingY: 5 },
      256
    );
    expect(withSidebar).toEqual(noSidebar);
  });
});
