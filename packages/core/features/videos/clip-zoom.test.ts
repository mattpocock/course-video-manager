import { describe, expect, it } from "vitest";
import {
  CLIP_ZOOM_TYPES,
  canZoomClip,
  checkClipZoomEligibility,
  clipZoomCropFilter,
  clipZoomCssStyle,
  clipZoomIneligibilityMessage,
  clipZoomRect,
  resolveClipZoomType,
  ZOOMABLE_SCENES,
} from "./clip-zoom.js";

/**
 * Resolve what an ffmpeg `crop=w:h:x:y` expression actually evaluates to for a
 * given source size. Mirrors ffmpeg's own arithmetic on `iw`/`ih` so the test
 * can compare the export's crop against the preview's transform in pixels
 * rather than by reading two strings and hoping.
 */
const evaluateCropFilter = (
  filter: string,
  iw: number,
  ih: number
): { x: number; y: number; width: number; height: number } => {
  const [, expressions] = filter.split("=");
  const [w, h, x, y] = expressions!.split(":").map((expression) =>
    // Every term is arithmetic over the two source dimensions.
    Function("iw", "ih", `return ${expression};`)(iw, ih)
  );
  return { x: x!, y: y!, width: w!, height: h! };
};

/**
 * The source region a CSS `transform: scale(s)` with `transform-origin`
 * (ox, oy) leaves visible inside the element's own box. A point p maps to
 * `origin + s * (p - origin)`, so the region surviving into [0, w] starts at
 * `ox * w * (1 - 1/s)` and is `w / s` wide.
 */
const evaluateCssStyle = (
  style: { transform: string; transformOrigin: string },
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } => {
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

describe("clip zoom", () => {
  describe("resolveClipZoomType", () => {
    it("passes through every known level", () => {
      for (const zoomType of CLIP_ZOOM_TYPES) {
        expect(resolveClipZoomType(zoomType)).toBe(zoomType);
      }
    });

    it("reads null, undefined and junk as no zoom", () => {
      expect(resolveClipZoomType(null)).toBe("none");
      expect(resolveClipZoomType(undefined)).toBe("none");
      expect(resolveClipZoomType("wildly-zoomed")).toBe("none");
    });
  });

  describe("the rect", () => {
    it("is absent for an unzoomed clip, so neither consumer emits anything", () => {
      expect(clipZoomRect("none")).toBeNull();
      expect(clipZoomCssStyle("none")).toBeNull();
      expect(clipZoomCropFilter("none")).toBeNull();
    });

    it("pins the subtle shot: 115%, centred in x, biased above centre in y", () => {
      expect(clipZoomRect("subtle")).toEqual({
        scale: 1.15,
        originX: 0.5,
        originY: 0.3,
      });
    });
  });

  /**
   * The requirement the whole feature hangs on: what the editor previews is
   * what the Publish ships. Both are formatted from one rect, and this is what
   * makes that a fact rather than an intention — the two are compared as
   * resolved pixel rectangles, at several resolutions.
   */
  describe("preview and export describe the same shot", () => {
    const RESOLUTIONS = [
      { label: "landscape 1080p", width: 1920, height: 1080 },
      { label: "portrait 1080x1920", width: 1080, height: 1920 },
      { label: "landscape 1440p", width: 2560, height: 1440 },
    ];

    for (const zoomType of CLIP_ZOOM_TYPES.filter((t) => t !== "none")) {
      for (const { label, width, height } of RESOLUTIONS) {
        it(`agree for "${zoomType}" at ${label}`, () => {
          const fromExport = evaluateCropFilter(
            clipZoomCropFilter(zoomType)!,
            width,
            height
          );
          const fromPreview = evaluateCssStyle(
            clipZoomCssStyle(zoomType)!,
            width,
            height
          );

          expect(fromPreview.x).toBeCloseTo(fromExport.x, 6);
          expect(fromPreview.y).toBeCloseTo(fromExport.y, 6);
          expect(fromPreview.width).toBeCloseTo(fromExport.width, 6);
          expect(fromPreview.height).toBeCloseTo(fromExport.height, 6);
        });
      }
    }

    it("crops toward the top of frame, not the centre", () => {
      const { y, height } = evaluateCropFilter(
        clipZoomCropFilter("subtle")!,
        1920,
        1080
      );
      const discardedAbove = y;
      const discardedBelow = 1080 - (y + height);

      expect(discardedAbove).toBeLessThan(discardedBelow);
    });

    it("keeps the crop inside the source frame", () => {
      const { x, y, width, height } = evaluateCropFilter(
        clipZoomCropFilter("subtle")!,
        1920,
        1080
      );

      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(1920);
      expect(y + height).toBeLessThanOrEqual(1080);
    });
  });

  describe("eligibility", () => {
    it("allows every camera scene", () => {
      for (const scene of ZOOMABLE_SCENES) {
        expect(canZoomClip(scene)).toBe(true);
        expect(checkClipZoomEligibility(scene)).toBeNull();
      }
    });

    it("refuses a scene that is not a camera", () => {
      for (const scene of ["Code", "No Face", "TikTok Code", "white noise"]) {
        expect(canZoomClip(scene)).toBe(false);
        expect(checkClipZoomEligibility(scene)).toEqual({
          reason: "not-a-camera-scene",
          scene,
        });
      }
    });

    it("refuses a clip with no recorded scene, and says so distinctly", () => {
      // ~4,500 clips predate scene capture. They are ineligible, but for a
      // different reason than a Code clip is, and the message has to say which.
      for (const scene of [null, undefined, ""]) {
        expect(canZoomClip(scene)).toBe(false);
        expect(checkClipZoomEligibility(scene)).toEqual({
          reason: "no-recorded-scene",
        });
      }

      expect(
        clipZoomIneligibilityMessage({ reason: "no-recorded-scene" })
      ).not.toBe(
        clipZoomIneligibilityMessage({
          reason: "not-a-camera-scene",
          scene: "Code",
        })
      );
    });

    it("names the offending scene in the refusal", () => {
      expect(
        clipZoomIneligibilityMessage({
          reason: "not-a-camera-scene",
          scene: "Code",
        })
      ).toContain("Code");
    });
  });
});
