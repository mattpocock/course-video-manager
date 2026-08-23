import { describe, it, expect } from "vitest";
import {
  bulletPanelAnimationFrames,
  bulletPanelExitStartFrame,
  bulletPanelRampProgress,
} from "../src/bullet-panel-timing";
import { BULLET_PANEL_ANIMATION_IN_SECONDS } from "../src/props";

const FPS = 60;
const ANIMATION_FRAMES = bulletPanelAnimationFrames(FPS);

describe("bulletPanelAnimationFrames", () => {
  it("is one ease at the composition's frame rate", () => {
    expect(ANIMATION_FRAMES).toBe(
      Math.round(BULLET_PANEL_ANIMATION_IN_SECONDS * FPS)
    );
  });

  it("never rounds down to nothing", () => {
    expect(bulletPanelAnimationFrames(1)).toBe(1);
  });
});

describe("bulletPanelExitStartFrame", () => {
  it("begins one ease before the end so an eased exit finishes on time", () => {
    expect(
      bulletPanelExitStartFrame({
        durationInFrames: 600,
        animationFrames: ANIMATION_FRAMES,
        disableExitAnimation: false,
      })
    ).toBe(600 - ANIMATION_FRAMES);
  });

  // REGRESSION. A disabled exit used to fire at `duration - animationFrames`,
  // which took the panel off screen an ease before the window ended — while
  // the camera Transform, whose exit ease the same flag zeroes, held the
  // shifted framing right to the last frame. The footage sat pushed aside with
  // nothing on top of it for 0.35s.
  it("holds a CUT exit to the window's very end, so the panel and the camera leave together", () => {
    const durationInFrames = 600;
    const exitStartFrame = bulletPanelExitStartFrame({
      durationInFrames,
      animationFrames: ANIMATION_FRAMES,
      disableExitAnimation: true,
    });

    expect(exitStartFrame).toBe(durationInFrames);

    // Nothing inside the window — the last frame drawn is `duration - 1` —
    // has started leaving.
    const lastFrame = durationInFrames - 1;
    expect(
      bulletPanelRampProgress({
        frame: lastFrame,
        startFrame: exitStartFrame,
        duration: ANIMATION_FRAMES,
        instant: true,
      })
    ).toBe(0);

    // Which is exactly what the eased exit is NOT doing at that frame: it has
    // been on its way out since `duration - animationFrames`.
    expect(
      bulletPanelRampProgress({
        frame: lastFrame,
        startFrame: bulletPanelExitStartFrame({
          durationInFrames,
          animationFrames: ANIMATION_FRAMES,
          disableExitAnimation: false,
        }),
        duration: ANIMATION_FRAMES,
        instant: false,
      })
    ).toBeGreaterThan(0);
  });
});

describe("bulletPanelRampProgress", () => {
  it("runs 0 -> 1 over its own frames", () => {
    const at = (frame: number) =>
      bulletPanelRampProgress({
        frame,
        startFrame: 100,
        duration: 20,
        instant: false,
      });

    expect(at(99)).toBe(0);
    expect(at(100)).toBe(0);
    expect(at(110)).toBeCloseTo(0.5);
    expect(at(120)).toBe(1);
    expect(at(500)).toBe(1);
  });

  it("changes at the same frame when it is instant, so a disabled enter animation does not retime a bullet", () => {
    const at = (frame: number) =>
      bulletPanelRampProgress({
        frame,
        startFrame: 100,
        duration: 20,
        instant: true,
      });

    expect(at(99)).toBe(0);
    expect(at(100)).toBe(1);
  });
});
