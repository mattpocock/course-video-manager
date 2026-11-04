import { describe, expect, it } from "vitest";
import { parseOverlayProps } from "../src/props";

describe("parseOverlayProps", () => {
  it("applies vertical 9:16 defaults for dimensions and fps", () => {
    const props = parseOverlayProps({
      durationInFrames: 180,
      subtitles: [{ startFrame: 0, endFrame: 60, text: "hello" }],
    });

    expect(props.width).toBe(1080);
    expect(props.height).toBe(1920);
    expect(props.fps).toBe(60);
  });

  it("defaults every content-kind to empty so a caller sends only what it draws", () => {
    const props = parseOverlayProps({ durationInFrames: 180 });

    expect(props.subtitles).toEqual([]);
    expect(props.callsToAction).toEqual([]);
    expect(props.definitionCards).toEqual([]);
    expect(props.bulletPanels).toEqual([]);

    // A card rendered as its own clip starts at the overlay's own start.
    const withCard = parseOverlayProps({
      durationInFrames: 180,
      definitionCards: [
        { title: "Clip", description: "A span.", durationInFrames: 180 },
      ],
    });
    expect(withCard.definitionCards[0]?.startFrame).toBe(0);
  });

  // ── Calls to Action ──────────────────────────────────────────────────

  it("no longer reads the old image-based `cta` as a Call to Action", () => {
    const props = parseOverlayProps({
      durationInFrames: 300,
      cta: { variant: "ai", durationInFrames: 120 },
    });

    expect(props.callsToAction).toEqual([]);
    expect(props).not.toHaveProperty("cta");
  });

  it("defaults a Call to Action to the overlay's start with both animations on", () => {
    const props = parseOverlayProps({
      durationInFrames: 300,
      callsToAction: [
        { title: "example.com", description: "", durationInFrames: 120 },
      ],
    });

    expect(props.callsToAction[0]).toEqual({
      title: "example.com",
      description: "",
      startFrame: 0,
      durationInFrames: 120,
      disableEnterAnimation: false,
      disableExitAnimation: false,
    });
  });

  // ── Bullet Panels ────────────────────────────────────────────────────

  const panel = (overrides: Record<string, unknown> = {}) => ({
    title: "What a spec answers",
    bullets: [
      { icon: "target", text: "Name the problem", revealAt: 0 },
      { icon: "route", text: "Name the decisions", revealAt: 1.5 },
    ],
    durationInFrames: 300,
    ...overrides,
  });

  it("defaults a Bullet Panel to the overlay's start with both animations on", () => {
    const props = parseOverlayProps({
      durationInFrames: 300,
      bulletPanels: [panel()],
    });

    expect(props.bulletPanels[0]?.startFrame).toBe(0);
    expect(props.bulletPanels[0]?.disableEnterAnimation).toBe(false);
    expect(props.bulletPanels[0]?.disableExitAnimation).toBe(false);
  });

  it("rejects a fifth bullet — the panel holds four", () => {
    expect(() =>
      parseOverlayProps({
        durationInFrames: 300,
        bulletPanels: [
          panel({
            bullets: [0, 1, 2, 3, 4].map((n) => ({
              icon: "target",
              text: `Point ${n}`,
              revealAt: n,
            })),
          }),
        ],
      })
    ).toThrow();
  });
});
