import { describe, expect, it } from "vitest";
import {
  OVERLAY_TRANSFORM_EASE_IN_SECONDS,
  overlayTransform,
  overlayTransformCssStyleAt,
  overlayTransformVideoFilter,
  type OverlayTransformWindow,
} from "./overlay-transform.js";

/**
 * Evaluate one of the filter's expressions at a moment, for a given input
 * size — ffmpeg's own arithmetic, in JavaScript, so the test can compare the
 * export against the preview in PIXELS rather than by reading two strings and
 * hoping.
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

/**
 * What the two-node chain does to one source frame at one moment: the size of
 * the frame that comes out, and where the SOURCE PICTURE's left edge sits
 * inside it.
 *
 * That second number is the whole feature. The `pad` puts the untouched
 * picture at `padX` on a wider canvas; the `crop` takes an original-sized
 * window back out at `cropX`; so the picture's left edge leaves the chain at
 * `padX - cropX` — which is exactly how far right the footage has slid.
 */
const evaluateVideoFilter = (
  chain: string,
  sourceWidth: number,
  sourceHeight: number,
  t: number
) => {
  // Split at the NODE boundary, not on every comma: the crop's own
  // expressions are full of them (`min`, `clip`, `lerp`).
  const [pad, crop] = chain.split(",crop=");
  const term = (node: string, name: string, iw: number, ih: number) =>
    evaluateExpression(
      new RegExp(`${name}='([^']*)'`).exec(node)![1]!,
      iw,
      ih,
      t
    );

  // The `pad` is static, and its `iw`/`ih` are the SOURCE's.
  const paddedWidth = term(pad!, "w", sourceWidth, sourceHeight);
  const padX = term(pad!, "x", sourceWidth, sourceHeight);

  // The `crop` sees the PADDED frame, so that is the `iw` its own expressions
  // are read against.
  const cropX = term(crop!, "x", paddedWidth, sourceHeight);

  return {
    paddedWidth,
    outputWidth: term(crop!, "w", paddedWidth, sourceHeight),
    outputHeight: term(crop!, "h", paddedWidth, sourceHeight),
    cropX,
    pictureLeftEdge: padX - cropX,
  };
};

/** How far right the preview has slid the footage, in pixels. */
const evaluateCssStyle = (style: { transform: string }, width: number) => {
  const percent = Number(/translateX\(([-\d.]+)%\)/.exec(style.transform)![1]);
  return { pictureLeftEdge: (percent / 100) * width };
};

const SOURCE_WIDTH = 2560;
const SOURCE_HEIGHT = 1440;

/** A Bullet Panel long enough for the move to arrive and hold. */
const panelWindow: OverlayTransformWindow & { kind: string } = {
  kind: "bulletPanel",
  startInSeconds: 12,
  endInSeconds: 20,
};

/** The arrived offset, as a fraction of frame width: the panel's own ground. */
const PANEL_OFFSET = 812 / 1920;

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
      expect(
        overlayTransformVideoFilter({
          kind: "definitionCard",
          startInSeconds: 0,
          endInSeconds: 5,
        })
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

  describe("the move is a slide and never a zoom", () => {
    it("states every end of every move as an offset alone", () => {
      // The type has no `scale` to set, so this is really a check that the
      // table has not grown one back through a cast.
      const transform = overlayTransform("bulletPanel")!;
      expect(Object.keys(transform.from)).toEqual(["offsetX"]);
      expect(Object.keys(transform.to)).toEqual(["offsetX"]);
      expect(transform.from.offsetX).toBe(0);
    });

    it("never puts a scale in the preview's CSS", () => {
      for (const moment of [12, 12.4, 16, 19.6, 20]) {
        const style = overlayTransformCssStyleAt(panelWindow, moment)!;
        expect(style.transform).toMatch(/^translateX\(/);
        expect(style.transform).not.toContain("scale");
      }
    });

    it("hands the export back a frame of the source's own size", () => {
      const filter = overlayTransformVideoFilter(panelWindow)!;
      for (const moment of [12, 12.4, 16, 19.6, 20]) {
        const { outputWidth, outputHeight } = evaluateVideoFilter(
          filter,
          SOURCE_WIDTH,
          SOURCE_HEIGHT,
          moment
        );
        // Same size in as out, on every frame, is what "no zoom" means once
        // the picture itself is only ever copied between the two.
        expect(outputWidth).toBeCloseTo(SOURCE_WIDTH, 6);
        expect(outputHeight).toBeCloseTo(SOURCE_HEIGHT, 6);
      }
    });
  });

  describe("the preview style", () => {
    it("is absent outside the Overlay's own window", () => {
      expect(overlayTransformCssStyleAt(panelWindow, 11.9)).toBeNull();
      expect(overlayTransformCssStyleAt(panelWindow, 20.1)).toBeNull();
    });

    it("starts unmoved and arrives at the panel's own width", () => {
      expect(overlayTransformCssStyleAt(panelWindow, 12)).toEqual({
        transform: "translateX(0%)",
      });
      expect(
        evaluateCssStyle(
          overlayTransformCssStyleAt(panelWindow, 16)!,
          SOURCE_WIDTH
        ).pictureLeftEdge
      ).toBeCloseTo(PANEL_OFFSET * SOURCE_WIDTH, 6);
    });

    it("is already arrived on the first frame when the enter is a cut", () => {
      const style = overlayTransformCssStyleAt(
        { ...panelWindow, disableEnterAnimation: true },
        12
      )!;
      expect(evaluateCssStyle(style, SOURCE_WIDTH).pictureLeftEdge).toBeCloseTo(
        PANEL_OFFSET * SOURCE_WIDTH,
        6
      );
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
    const filter = overlayTransformVideoFilter(panelWindow)!;

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
        const fromCss = evaluateCssStyle(style, SOURCE_WIDTH);
        const fromFilter = evaluateVideoFilter(
          filter,
          SOURCE_WIDTH,
          SOURCE_HEIGHT,
          moment
        );

        // The export's own ease is a piecewise-linear ladder sampled from the
        // curve the preview solves exactly, so the two agree to within a
        // pixel or so rather than to the bit.
        expect(fromFilter.pictureLeftEdge).toBeCloseTo(
          fromCss.pictureLeftEdge,
          0
        );
      });
    }

    it("keeps the crop inside the padded canvas throughout", () => {
      for (const moment of moments) {
        const { cropX, outputWidth, paddedWidth } = evaluateVideoFilter(
          filter,
          SOURCE_WIDTH,
          SOURCE_HEIGHT,
          moment
        );
        expect(cropX).toBeGreaterThanOrEqual(-0.5);
        expect(cropX + outputWidth).toBeLessThanOrEqual(paddedWidth + 0.5);
      }
    });

    it("is an identity outside the Overlay's window", () => {
      // There is no `enable=` gate on either node, so the ONLY thing keeping
      // the rest of the video untouched is that the ramps read zero out
      // there. If that ever stops being true the whole video slides.
      expect(filter).not.toContain("enable=");
      for (const moment of [0, 5, 11.9, 20.1, 60]) {
        const { pictureLeftEdge, outputWidth, outputHeight } =
          evaluateVideoFilter(filter, SOURCE_WIDTH, SOURCE_HEIGHT, moment);
        expect(pictureLeftEdge).toBeCloseTo(0, 6);
        expect(outputWidth).toBeCloseTo(SOURCE_WIDTH, 6);
        expect(outputHeight).toBeCloseTo(SOURCE_HEIGHT, 6);
      }
    });
  });
});
