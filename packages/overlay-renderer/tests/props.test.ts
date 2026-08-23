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
});
