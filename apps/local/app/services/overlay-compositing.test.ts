import { describe, expect, it } from "vitest";
import {
  buildOverlayCompositeArgs,
  buildOverlayCompositeFilterGraph,
  placeOverlaysOnTimeline,
} from "./overlay-compositing";
import {
  LONG_PAUSE_DURATION_IN_SECONDS,
  type ExportClipDuration,
} from "./export-duration-check";
import type { ExportOverlay } from "./export-hash";

const card = (overrides?: Partial<ExportOverlay>): ExportOverlay => ({
  at: 0,
  durationInSeconds: 5,
  title: "Monomorphism",
  description: "A function that never collapses two inputs into one output.",
  ...overrides,
});

const clip = (
  duration: number,
  pauseType: "none" | "long" = "none"
): ExportClipDuration => ({ duration, pauseType });

describe("placeOverlaysOnTimeline", () => {
  it("places an Overlay on the first Clip at its own anchor", () => {
    const placed = placeOverlaysOnTimeline(
      [{ overlays: [card({ at: 3, durationInSeconds: 4 })] }],
      [clip(30)]
    );

    expect(placed).toHaveLength(1);
    expect(placed[0]!.startInSeconds).toBe(3);
    expect(placed[0]!.endInSeconds).toBe(7);
  });

  it("sums every preceding Clip to reach a later Clip's anchor", () => {
    const placed = placeOverlaysOnTimeline(
      [
        { overlays: [] },
        { overlays: [] },
        { overlays: [card({ at: 2, durationInSeconds: 3 })] },
      ],
      [clip(10), clip(20), clip(30)]
    );

    expect(placed[0]!.startInSeconds).toBe(32);
    expect(placed[0]!.endInSeconds).toBe(35);
  });

  it("counts a preceding Clip's long Pause as part of the timeline", () => {
    const placed = placeOverlaysOnTimeline(
      [{ overlays: [] }, { overlays: [card({ at: 1 })] }],
      [clip(10, "long"), clip(20)]
    );

    expect(placed[0]!.startInSeconds).toBe(
      10 + LONG_PAUSE_DURATION_IN_SECONDS + 1
    );
  });

  it("keeps an Overlay on screen past the end of its anchor Clip", () => {
    const placed = placeOverlaysOnTimeline(
      [{ overlays: [card({ at: 8, durationInSeconds: 9 })] }, { overlays: [] }],
      [clip(10), clip(20)]
    );

    // Anchored 2s before its Clip ends, and still there 7s into the next one.
    expect(placed[0]!.startInSeconds).toBe(8);
    expect(placed[0]!.endInSeconds).toBe(17);
  });

  it("truncates an Overlay that runs past the end of the Video", () => {
    const placed = placeOverlaysOnTimeline(
      [{ overlays: [card({ at: 8, durationInSeconds: 60 })] }],
      [clip(10)]
    );

    expect(placed[0]!.endInSeconds).toBe(10);
    // Truncating what is SHOWN never changes what is RENDERED: the card is
    // still a 60s render, so it is the same cached file wherever it appears.
    expect(placed[0]!.content.durationInSeconds).toBe(60);
  });

  it("drops an Overlay anchored at or past the end of the Video", () => {
    expect(
      placeOverlaysOnTimeline(
        [{ overlays: [card({ at: 10 }), card({ at: 99 })] }],
        [clip(10)]
      )
    ).toEqual([]);
  });

  it("carries each Overlay's own card content through", () => {
    const placed = placeOverlaysOnTimeline(
      [
        {
          overlays: [
            card({ at: 1, title: "Functor", description: "Maps structure." }),
          ],
        },
      ],
      [clip(10)]
    );

    expect(placed[0]!.content).toEqual({
      title: "Functor",
      description: "Maps structure.",
      durationInSeconds: 5,
    });
  });

  it("orders Overlays by Clip, then by the order the Clip holds them", () => {
    const placed = placeOverlaysOnTimeline(
      [
        { overlays: [card({ at: 1, title: "first" })] },
        {
          overlays: [
            card({ at: 0, title: "second" }),
            card({ at: 1, title: "third" }),
          ],
        },
      ],
      [clip(10), clip(10)]
    );

    expect(placed.map((p) => p.content.title)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("finds nothing on a Video with no Overlays", () => {
    expect(
      placeOverlaysOnTimeline(
        [{ overlays: [] }, { overlays: [] }],
        [clip(10), clip(10)]
      )
    ).toEqual([]);
  });
});

describe("buildOverlayCompositeFilterGraph", () => {
  it("has no graph at all for no Overlays, so the pass can be skipped", () => {
    expect(buildOverlayCompositeFilterGraph([])).toBeNull();
  });

  it("shifts one Overlay onto its moment and gates it there", () => {
    expect(
      buildOverlayCompositeFilterGraph([
        { startInSeconds: 1.5, endInSeconds: 4.5 },
      ])
    ).toBe(
      "[1:v]setpts=PTS-STARTPTS+1.500/TB[ovl0];" +
        "[0:v][ovl0]overlay=x=0:y=0:format=auto:eof_action=pass:repeatlast=0" +
        ":enable='between(t,1.500,4.500)'[outv]"
    );
  });

  it("chains three Overlays into ONE pass, not three", () => {
    const graph = buildOverlayCompositeFilterGraph([
      { startInSeconds: 1, endInSeconds: 2 },
      { startInSeconds: 10, endInSeconds: 12 },
      { startInSeconds: 30, endInSeconds: 35 },
    ])!;

    // One overlay node per Overlay, each feeding the next.
    expect(graph.match(/overlay=/g)).toHaveLength(3);
    expect(graph).toContain("[0:v][ovl0]");
    expect(graph).toContain("[comp0][ovl1]");
    expect(graph).toContain("[comp1][ovl2]");
    // Exactly one output, which is what `-map [outv]` asks for.
    expect(graph.match(/\[outv\]/g)).toHaveLength(1);
    expect(graph.endsWith("[outv]")).toBe(true);
  });

  it("takes each Overlay from its own input, in order", () => {
    const graph = buildOverlayCompositeFilterGraph([
      { startInSeconds: 1, endInSeconds: 2 },
      { startInSeconds: 3, endInSeconds: 4 },
    ])!;

    expect(graph).toContain("[1:v]setpts=PTS-STARTPTS+1.000/TB[ovl0]");
    expect(graph).toContain("[2:v]setpts=PTS-STARTPTS+3.000/TB[ovl1]");
  });

  it("spells seconds so ffmpeg's expression parser cannot misread them", () => {
    const graph = buildOverlayCompositeFilterGraph([
      { startInSeconds: 0.0000001, endInSeconds: 1234567.5 },
    ])!;

    expect(graph).not.toMatch(/e[+-]\d/);
    expect(graph).toContain("enable='between(t,0.000,1234567.500)'");
  });
});

describe("buildOverlayCompositeArgs", () => {
  const card = {
    overlayPath: "/cache/a.mov",
    startInSeconds: 1,
    endInSeconds: 4,
  };

  it("feeds ffmpeg the video first and one input per card", () => {
    const args = buildOverlayCompositeArgs(
      "/in.mp4",
      [card, { ...card, overlayPath: "/cache/b.mov" }],
      "/out.mp4"
    )!;

    const inputs = args.flatMap((arg, i) =>
      arg === "-i" ? [args[i + 1]] : []
    );
    expect(inputs).toEqual(["/in.mp4", "/cache/a.mov", "/cache/b.mov"]);
    expect(args.at(-1)).toBe("/out.mp4");
  });

  it("encodes the picture the way the landscape export does, not the way a Short does", () => {
    const args = buildOverlayCompositeArgs("/in.mp4", [card], "/out.mp4")!;

    // The concat pass that produced /in.mp4 encodes on the GPU at a set
    // bitrate. This pass re-encodes the same file, so a course video with a
    // Definition Card must not come out of a second-generation CPU encode
    // with different characteristics from every course video without one.
    expect(args).toContain("h264_nvenc");
    expect(args).not.toContain("libx264");
    expect(args).not.toContain("-crf");
  });

  it("leaves the already-normalized audio alone", () => {
    const args = buildOverlayCompositeArgs("/in.mp4", [card], "/out.mp4")!;

    expect(args.slice(args.indexOf("-c:a"), args.indexOf("-c:a") + 2)).toEqual([
      "-c:a",
      "copy",
    ]);
  });

  it("has no command line at all for a video with no cards", () => {
    expect(buildOverlayCompositeArgs("/in.mp4", [], "/out.mp4")).toBeNull();
  });
});
