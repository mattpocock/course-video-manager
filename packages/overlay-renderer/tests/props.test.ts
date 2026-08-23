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
    expect(props.cta).toBeNull();
  });

  it("defaults every content-kind to empty so a caller sends only what it draws", () => {
    const props = parseOverlayProps({ durationInFrames: 180 });

    expect(props.subtitles).toEqual([]);
    expect(props.cta).toBeNull();
    expect(props.definitionCards).toEqual([]);
    expect(props.bulletPanels).toEqual([]);
  });

  it("leaves the Shorts pipeline's existing props untouched", () => {
    // The vertical pipeline knows nothing about Definition Cards; its props
    // must keep parsing exactly as before the field was added.
    const props = parseOverlayProps({
      width: 1080,
      height: 1920,
      fps: 60,
      durationInFrames: 300,
      subtitles: [{ startFrame: 0, endFrame: 55, text: "hello" }],
      cta: { variant: "ai", durationInFrames: 120 },
    });

    expect(props.definitionCards).toEqual([]);
    expect(props.bulletPanels).toEqual([]);
  });

  it("keeps explicit dimensions and a CTA", () => {
    const props = parseOverlayProps({
      width: 720,
      height: 1280,
      fps: 30,
      durationInFrames: 90,
      subtitles: [],
      cta: { variant: "typescript", durationInFrames: 45 },
    });

    expect(props).toMatchObject({
      width: 720,
      height: 1280,
      fps: 30,
      cta: { variant: "typescript", durationInFrames: 45 },
    });
  });

  it("preserves word-timed caption segments verbatim", () => {
    const subtitles = [
      { startFrame: 0, endFrame: 55, text: "There's an idea floating around" },
      {
        startFrame: 55,
        endFrame: 165,
        text: "that I think is mostly rubbish,",
      },
    ];
    const props = parseOverlayProps({ durationInFrames: 200, subtitles });
    expect(props.subtitles).toEqual(subtitles);
  });

  it("keeps a Definition Card's authored title and description verbatim", () => {
    const props = parseOverlayProps({
      width: 1920,
      height: 1080,
      durationInFrames: 240,
      definitionCards: [
        {
          title: "Ubiquitous Language",
          description: "One shared vocabulary for a domain.",
          durationInFrames: 240,
        },
      ],
    });

    expect(props.definitionCards).toEqual([
      {
        title: "Ubiquitous Language",
        description: "One shared vocabulary for a domain.",
        // A card rendered as its own clip starts at the overlay's own start.
        startFrame: 0,
        durationInFrames: 240,
      },
    ]);
  });

  it("keeps an explicit Definition Card start frame", () => {
    const props = parseOverlayProps({
      durationInFrames: 600,
      definitionCards: [
        {
          title: "Clip",
          description: "A span of footage.",
          startFrame: 120,
          durationInFrames: 180,
        },
      ],
    });

    expect(props.definitionCards[0]?.startFrame).toBe(120);
  });

  it("rejects a Definition Card with no description", () => {
    expect(() =>
      parseOverlayProps({
        durationInFrames: 60,
        definitionCards: [{ title: "Clip", durationInFrames: 60 }],
      })
    ).toThrow();
  });

  it("rejects an unknown CTA variant", () => {
    expect(() =>
      parseOverlayProps({
        durationInFrames: 60,
        subtitles: [],
        cta: { variant: "sales", durationInFrames: 30 },
      })
    ).toThrow();
  });

  it("requires durationInFrames", () => {
    expect(() => parseOverlayProps({ subtitles: [] })).toThrow();
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

  it("keeps a Bullet Panel's title, icons, text and reveal times verbatim", () => {
    const props = parseOverlayProps({
      durationInFrames: 300,
      bulletPanels: [panel()],
    });

    const parsed = props.bulletPanels[0];
    expect(parsed?.title).toBe("What a spec answers");
    expect(parsed?.bullets).toEqual([
      { icon: "target", text: "Name the problem", revealAt: 0 },
      { icon: "route", text: "Name the decisions", revealAt: 1.5 },
    ]);
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

  it("keeps an explicit Bullet Panel start frame and animation toggles", () => {
    const props = parseOverlayProps({
      durationInFrames: 600,
      bulletPanels: [
        panel({
          startFrame: 120,
          disableEnterAnimation: true,
          disableExitAnimation: true,
        }),
      ],
    });

    expect(props.bulletPanels[0]).toMatchObject({
      startFrame: 120,
      disableEnterAnimation: true,
      disableExitAnimation: true,
    });
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

  it("rejects a bullet missing its icon or its reveal time", () => {
    expect(() =>
      parseOverlayProps({
        durationInFrames: 300,
        bulletPanels: [panel({ bullets: [{ text: "No glyph", revealAt: 0 }] })],
      })
    ).toThrow();
    expect(() =>
      parseOverlayProps({
        durationInFrames: 300,
        bulletPanels: [panel({ bullets: [{ icon: "target", text: "When?" }] })],
      })
    ).toThrow();
  });

  it("leaves a Definition-Card-only caller's props parsing unchanged", () => {
    // Back-compat: the landscape pipeline sent no `bulletPanels` before this
    // content-kind existed, and its props must still be complete without it.
    const props = parseOverlayProps({
      durationInFrames: 180,
      definitionCards: [
        { title: "Clip", description: "A span.", durationInFrames: 180 },
      ],
    });

    expect(props.bulletPanels).toEqual([]);
    expect(props.definitionCards).toHaveLength(1);
  });
});
