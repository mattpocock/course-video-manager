import { describe, expect, it } from "vitest";
import {
  overlayPropsSchema,
  BULLET_PANEL_ANIMATION_IN_SECONDS as RENDERER_EASE,
} from "@cvm/overlay-renderer/props";
import {
  OVERLAY_CONTENT_FPS,
  OVERLAY_TRANSFORM_EASE_IN_SECONDS,
} from "@/features/videos/overlay-transform";
import { overlayRenderProps } from "@/services/overlay-content-props";
import {
  OVERLAY_RENDER_FPS,
  OVERLAY_RENDER_FRAME,
  type BulletPanelContent,
  type DefinitionCardContent,
} from "@/services/overlay-render-cache";

const content: DefinitionCardContent = {
  kind: "definitionCard",
  title: "Hydration",
  description: "Attaching React to server-rendered HTML.",
  durationInSeconds: 4.25,
};

const panel: BulletPanelContent = {
  kind: "bulletPanel",
  title: "What a Server Component does",
  bullets: [
    { icon: "circle-check", text: "Runs on the server", revealAt: 0.5 },
    { icon: "database", text: "Reaches the database", revealAt: 2 },
  ],
  durationInSeconds: 6,
  disableEnterAnimation: false,
  disableExitAnimation: false,
};

/**
 * The one place the panel's speed and the camera's speed can be compared.
 *
 * `packages/core` owns the number; `packages/overlay-renderer` repeats it,
 * because the renderer must not depend on the domain database. This app is the
 * only package that depends on BOTH, so this is where the repetition stops
 * being a comment and starts being enforced.
 *
 * If this fails, the panel has been retuned without the camera or the other
 * way round — which ships a panel that arrives while the face is still moving.
 * Fix the two constants, not this test.
 */
describe("the panel and the camera move at one speed", () => {
  it("holds the renderer's ease equal to the domain's", () => {
    expect(RENDERER_EASE).toBe(OVERLAY_TRANSFORM_EASE_IN_SECONDS);
  });

  /**
   * The camera is read on the frame grid of the content it is moving for, so
   * it has to know that content's frame rate. `packages/core` cannot import
   * {@link OVERLAY_RENDER_FPS} — it must stay free of anything filesystem-
   * bound — so it repeats the number, and this is again the only package that
   * sees both.
   *
   * If this fails, the footage is being sampled on a grid the panel is not
   * drawn on, and the two slide apart by up to a frame's travel — 38px at the
   * quickest part of the ease. Fix the two constants, not this test.
   */
  it("holds the camera's frame grid equal to the content's frame rate", () => {
    expect(OVERLAY_CONTENT_FPS).toBe(OVERLAY_RENDER_FPS);
  });
});

describe("overlayRenderProps", () => {
  describe("Definition Cards", () => {
    it("renders the card as its own clip, exactly as long as the card", () => {
      const props = overlayRenderProps(content);

      expect(props.definitionCards).toHaveLength(1);
      expect(props.definitionCards[0]!.durationInFrames).toBe(
        props.durationInFrames
      );
    });

    it("covers the whole of a duration that lands between two frames", () => {
      const props = overlayRenderProps({
        ...content,
        durationInSeconds: 4.25,
      });

      expect(props.durationInFrames).toBe(Math.ceil(4.25 * OVERLAY_RENDER_FPS));
      expect(
        props.durationInFrames / OVERLAY_RENDER_FPS
      ).toBeGreaterThanOrEqual(4.25);
    });

    it("renders at the landscape export frame", () => {
      const props = overlayRenderProps(content);

      expect({ width: props.width, height: props.height }).toEqual(
        OVERLAY_RENDER_FRAME
      );
    });

    it("draws no panel", () => {
      expect(overlayRenderProps(content).bulletPanels).toEqual([]);
    });
  });

  describe("Bullet Panels", () => {
    it("renders the panel as its own clip, exactly as long as the Overlay", () => {
      const props = overlayRenderProps(panel);

      expect(props.bulletPanels).toHaveLength(1);
      expect(props.bulletPanels[0]!.durationInFrames).toBe(
        props.durationInFrames
      );
      expect(props.durationInFrames).toBe(Math.ceil(6 * OVERLAY_RENDER_FPS));
    });

    it("starts on frame 0, so the composite pass's shift is what times it", () => {
      // The pass shifts this whole clip to the Overlay's start with `setpts`
      // and gates it to the same window the camera's crop node is gated to. A
      // non-zero start frame here would slide the panel off its own camera move.
      expect(overlayRenderProps(panel).bulletPanels[0]!.startFrame).toBe(0);
    });

    it("carries each bullet's icon, text and revealAt, in order and in seconds", () => {
      expect(overlayRenderProps(panel).bulletPanels[0]!.bullets).toEqual([
        { icon: "circle-check", text: "Runs on the server", revealAt: 0.5 },
        { icon: "database", text: "Reaches the database", revealAt: 2 },
      ]);
    });

    it("carries both Animation Toggles", () => {
      const props = overlayRenderProps({
        ...panel,
        disableEnterAnimation: true,
        disableExitAnimation: true,
      });

      expect(props.bulletPanels[0]).toMatchObject({
        disableEnterAnimation: true,
        disableExitAnimation: true,
      });
    });

    it("draws no card", () => {
      expect(overlayRenderProps(panel).definitionCards).toEqual([]);
    });
  });

  /**
   * The props cross a process boundary as JSON — this app spawns the renderer's
   * `bin.mjs` rather than importing it, so nothing else would notice a field
   * this app spells differently from the schema on the far side. Parsing the
   * built object with the renderer's OWN schema is what holds the two together.
   */
  describe("the renderer's own schema accepts what this app builds", () => {
    it("accepts a Definition Card's props", () => {
      expect(() =>
        overlayPropsSchema.parse(overlayRenderProps(content))
      ).not.toThrow();
    });

    it("accepts a Bullet Panel's props unchanged", () => {
      const built = overlayRenderProps(panel);
      const parsed = overlayPropsSchema.parse(built);

      expect(parsed.bulletPanels).toEqual(built.bulletPanels);
    });

    it("refuses a fifth bullet, so an over-long panel fails here and not in Chromium", () => {
      expect(() =>
        overlayPropsSchema.parse(
          overlayRenderProps({
            ...panel,
            bullets: [1, 2, 3, 4, 5].map((n) => ({
              icon: "circle-check",
              text: `Bullet ${n}`,
              revealAt: n * 0.5,
            })),
          })
        )
      ).toThrow();
    });
  });
});
