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
      { startFrame: 55, endFrame: 165, text: "that I think is mostly rubbish," },
    ];
    const props = parseOverlayProps({ durationInFrames: 200, subtitles });
    expect(props.subtitles).toEqual(subtitles);
  });

  it("rejects an unknown CTA variant", () => {
    expect(() =>
      parseOverlayProps({
        durationInFrames: 60,
        subtitles: [],
        cta: { variant: "sales", durationInFrames: 30 },
      }),
    ).toThrow();
  });

  it("requires durationInFrames", () => {
    expect(() => parseOverlayProps({ subtitles: [] })).toThrow();
  });
});
