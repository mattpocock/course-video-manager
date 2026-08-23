import { describe, expect, it } from "vitest";
import {
  OVERLAY_TRANSFORM_EASE_IN_SECONDS,
  overlayTransform,
  overlayTransformCropFilter,
  overlayTransformCssStyleAt,
  type OverlayTransformWindow,
} from "./overlay-transform.js";

/**
 * Evaluate one of the four `crop` expressions at a moment, for a given source
 * size — ffmpeg's own arithmetic, in JavaScript, so the test can compare the
 * export's crop against the preview's transform in PIXELS rather than by
 * reading two strings and hoping.
 *
 * The dialect is small and entirely arithmetic: `st`/`ld` are the numbered
 * slots, `;` sequences them, and `if`/`lt`/`min`/`clip`/`lerp` are ffmpeg's
 * own functions. `if` is evaluated eagerly here, which its uses in this file
 * allow — every branch is plain arithmetic with nothing to guard against.
 */
const evaluateExpression = (
  expression: string,
  iw: number,
  ih: number,
  t: number
): number => {
  const js = expression
    .replace(/\bif\(/g, "IF(")
    .replace(/\bst\(/g, "ST(")
    .replace(/\bld\(/g, "LD(")
    .replace(/\blerp\(/g, "LERP(")
    .replace(/\bclip\(/g, "CLIP(")
    .replace(/\blt\(/g, "LT(")
    .replace(/\bmin\(/g, "MIN(")
    // Sequenced statements become one comma expression, which is exactly what
    // ffmpeg's `;` is: evaluate each, take the last.
    .replace(/;/g, ",");

  const slots: number[] = [];
  const helpers = {
    ST: (slot: number, value: number) => (slots[slot] = value),
    LD: (slot: number) => slots[slot] ?? 0,
    LERP: (from: number, to: number, p: number) => from + (to - from) * p,
    CLIP: (value: number, low: number, high: number) =>
      Math.min(high, Math.max(low, value)),
    LT: (a: number, b: number) => (a < b ? 1 : 0),
    MIN: (a: number, b: number) => Math.min(a, b),
    IF: (condition: number, then: number, otherwise: number) =>
      condition !== 0 ? then : otherwise,
  };

  return Function(
    "iw",
    "ih",
    "t",
    ...Object.keys(helpers),
    `return (${js});`
  )(iw, ih, t, ...Object.values(helpers));
};

/** The source region the export's `crop` keeps at a moment, in pixels. */
const evaluateCropFilter = (
  filter: string,
  iw: number,
  ih: number,
  t: number
) => {
  const term = (name: string) =>
    evaluateExpression(
      new RegExp(`${name}='([^']*)'`).exec(filter)![1]!,
      iw,
      ih,
      t
    );
  return {
    x: term("x"),
    y: term("y"),
    width: term("w"),
    height: term("h"),
  };
};

/**
 * The source region a CSS `transform: scale(s)` with `transform-origin`
 * (ox, oy) leaves visible inside the element's own box — the same arithmetic
 * `clip-zoom.test.ts` uses, because it is the same contract.
 */
const evaluateCssStyle = (
  style: { transform: string; transformOrigin: string },
  width: number,
  height: number
) => {
  const scale = Number(/scale\(([-\d.]+)\)/.exec(style.transform)![1]);
  const [originX, originY] = style.transformOrigin
    .split(" ")
    .map((part) => Number(part.replace("%", "")) / 100);

  return {
    x: originX! * width * (1 - 1 / scale),
    y: originY! * height * (1 - 1 / scale),
    width: width / scale,
    height: height / scale,
  };
};

const SOURCE_WIDTH = 2560;
const SOURCE_HEIGHT = 1440;

/** A Bullet Panel long enough for the move to arrive and hold. */
const panelWindow: OverlayTransformWindow & { kind: string } = {
  kind: "bulletPanel",
  startInSeconds: 12,
  endInSeconds: 20,
};

describe("overlay transform", () => {
  describe("which kinds move the camera", () => {
    it("moves nothing for a Definition Card, at any moment", () => {
      expect(overlayTransform("definitionCard")).toBeNull();
      expect(
        overlayTransformCssStyleAt(
          { kind: "definitionCard", startInSeconds: 0, endInSeconds: 5 },
          2
        )
      ).toBeNull();
    });

    it("moves nothing for a kind this build does not know", () => {
      expect(
        overlayTransformCssStyleAt(
          { kind: "diagram", startInSeconds: 0, endInSeconds: 5 },
          2
        )
      ).toBeNull();
    });
  });

  describe("the preview style", () => {
    it("is absent outside the Overlay's own window", () => {
      expect(overlayTransformCssStyleAt(panelWindow, 11.9)).toBeNull();
      expect(overlayTransformCssStyleAt(panelWindow, 20.1)).toBeNull();
    });

    it("starts centred and arrives at the panel's framing", () => {
      expect(overlayTransformCssStyleAt(panelWindow, 12)).toEqual({
        transform: "scale(1)",
        transformOrigin: "50% 50%",
      });
      expect(overlayTransformCssStyleAt(panelWindow, 16)).toEqual({
        transform: "scale(1.3)",
        transformOrigin: "62% 40%",
      });
    });

    it("is already arrived on the first frame when the enter is a cut", () => {
      expect(
        overlayTransformCssStyleAt(
          { ...panelWindow, disableEnterAnimation: true },
          12
        )
      ).toEqual({
        transform: "scale(1.3)",
        transformOrigin: "62% 40%",
      });
    });

    it("reads the same on the Clip's clock as on the Video's", () => {
      // What the editor asks: the same Overlay, seen from a Clip it spilled
      // onto, so its start is NEGATIVE. Only the difference between the window
      // and the moment is ever used, so the framing must not move.
      const spilled = { ...panelWindow, startInSeconds: -3, endInSeconds: 5 };
      expect(overlayTransformCssStyleAt(spilled, 1)).toEqual(
        overlayTransformCssStyleAt(panelWindow, 16)
      );
      expect(overlayTransformCssStyleAt(spilled, -3 + 0.2)).toEqual(
        overlayTransformCssStyleAt(panelWindow, 12.2)
      );
    });
  });

  describe("preview and export frame the same shot", () => {
    const filter = overlayTransformCropFilter(panelWindow)!;

    // Through the ease in, across the hold, and back out through the ease out.
    const moments = [
      panelWindow.startInSeconds,
      panelWindow.startInSeconds + OVERLAY_TRANSFORM_EASE_IN_SECONDS / 2,
      panelWindow.startInSeconds + OVERLAY_TRANSFORM_EASE_IN_SECONDS,
      16,
      panelWindow.endInSeconds - OVERLAY_TRANSFORM_EASE_IN_SECONDS / 2,
      panelWindow.endInSeconds,
    ];

    for (const moment of moments) {
      it(`agree at t=${moment}s`, () => {
        const style = overlayTransformCssStyleAt(panelWindow, moment)!;
        const fromCss = evaluateCssStyle(style, SOURCE_WIDTH, SOURCE_HEIGHT);
        const fromCrop = evaluateCropFilter(
          filter,
          SOURCE_WIDTH,
          SOURCE_HEIGHT,
          moment
        );

        // The export's own ease is a piecewise-linear ladder sampled from the
        // curve the preview solves exactly, so the two agree to within a
        // pixel or so rather than to the bit.
        expect(fromCrop.width).toBeCloseTo(fromCss.width, 0);
        expect(fromCrop.height).toBeCloseTo(fromCss.height, 0);
        expect(fromCrop.x).toBeCloseTo(fromCss.x, 0);
        expect(fromCrop.y).toBeCloseTo(fromCss.y, 0);
      });
    }

    it("keeps the crop inside the source frame throughout", () => {
      for (const moment of moments) {
        const { x, y, width, height } = evaluateCropFilter(
          filter,
          SOURCE_WIDTH,
          SOURCE_HEIGHT,
          moment
        );
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + width).toBeLessThanOrEqual(SOURCE_WIDTH + 0.5);
        expect(y + height).toBeLessThanOrEqual(SOURCE_HEIGHT + 0.5);
      }
    });
  });
});
