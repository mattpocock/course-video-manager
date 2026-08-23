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
import { OVERLAY_TRANSFORM_EASE_IN_SECONDS } from "@/features/videos/overlay-transform";

/**
 * The ease, spelled as the filter graph spells it. Read from the constant
 * rather than typed out, because retuning the speed of the move is meant to be
 * a one-line edit in `overlay-transform.ts` — a test that hardcodes the old
 * number turns that one line into four.
 */
const EASE = OVERLAY_TRANSFORM_EASE_IN_SECONDS.toFixed(6);

const card = (overrides?: Partial<ExportOverlay>): ExportOverlay => ({
  at: 0,
  durationInSeconds: 5,
  kind: "definitionCard",
  disableEnterAnimation: false,
  disableExitAnimation: false,
  title: "Monomorphism",
  description: "A function that never collapses two inputs into one output.",
  bullets: null,
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
      kind: "definitionCard",
      title: "Functor",
      description: "Maps structure.",
      durationInSeconds: 5,
    });
  });

  it("carries a Bullet Panel's bullets and toggles through, and no description", () => {
    const bullets = [
      { icon: "circle-check", text: "Runs on the server", revealAt: 0.5 },
    ];
    const placed = placeOverlaysOnTimeline(
      [
        {
          overlays: [
            card({
              at: 1,
              kind: "bulletPanel",
              title: "What it does",
              // A Bullet Panel has no description; the column holds "".
              description: "",
              bullets,
              disableEnterAnimation: true,
            }),
          ],
        },
      ],
      [clip(10)]
    );

    expect(placed[0]!.content).toEqual({
      kind: "bulletPanel",
      title: "What it does",
      bullets,
      durationInSeconds: 5,
      disableEnterAnimation: true,
      disableExitAnimation: false,
    });
  });

  it("treats a Bullet Panel with no bullets as a panel, not as a card", () => {
    const placed = placeOverlaysOnTimeline(
      [{ overlays: [card({ kind: "bulletPanel", bullets: null })] }],
      [clip(10)]
    );

    expect(placed[0]!.content).toMatchObject({
      kind: "bulletPanel",
      bullets: [],
    });
  });

  it("reads an unknown kind as a Definition Card, the way the column does", () => {
    const placed = placeOverlaysOnTimeline(
      [{ overlays: [card({ kind: "somethingNobodyShipped" })] }],
      [clip(10)]
    );

    expect(placed[0]!.content.kind).toBe("definitionCard");
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

  it("carries what the footage under an Overlay has to do", () => {
    const placed = placeOverlaysOnTimeline(
      [
        {
          overlays: [
            card({
              at: 1,
              kind: "bulletPanel",
              disableEnterAnimation: true,
              disableExitAnimation: false,
            }),
          ],
        },
      ],
      [clip(10)]
    );

    // The KIND travels, not a Transform: the move is looked up from it, so
    // there is nothing here to hold a stale copy of.
    expect(placed[0]!.kind).toBe("bulletPanel");
    expect(placed[0]!.disableEnterAnimation).toBe(true);
    expect(placed[0]!.disableExitAnimation).toBe(false);
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

describe("buildOverlayCompositeFilterGraph — the camera Transform", () => {
  const panel = (
    overrides: Partial<{
      startInSeconds: number;
      endInSeconds: number;
      kind: string;
      disableEnterAnimation: boolean;
      disableExitAnimation: boolean;
    }> = {}
  ) => ({
    startInSeconds: 1.5,
    endInSeconds: 4.5,
    kind: "bulletPanel",
    disableEnterAnimation: false,
    disableExitAnimation: false,
    ...overrides,
  });

  it("leaves the footage alone for a Definition Card", () => {
    const graph = buildOverlayCompositeFilterGraph([
      panel({ kind: "definitionCard" }),
    ])!;

    expect(graph).not.toContain("crop=");
    expect(graph).not.toContain("scale=");
    // Byte-for-byte the graph a Definition Card has always produced.
    expect(graph).toBe(
      "[1:v]setpts=PTS-STARTPTS+1.500/TB[ovl0];" +
        "[0:v][ovl0]overlay=x=0:y=0:format=auto:eof_action=pass:repeatlast=0" +
        ":enable='between(t,1.500,4.500)'[outv]"
    );
  });

  it("reads an Overlay written before the kind column the same way", () => {
    expect(
      buildOverlayCompositeFilterGraph([{ ...panel(), kind: "" }])
    ).not.toContain("crop=");
  });

  it("moves the camera under a bulletPanel, before anything is drawn on it", () => {
    const graph = buildOverlayCompositeFilterGraph([panel()])!;

    // The crop takes the video, and the graphic chain takes the crop's output.
    expect(graph).toContain("[0:v]crop=");
    expect(graph).toContain("[tf0][ovl0]overlay=");
  });

  it("gates the move to the Overlay's own window on the Video's timeline", () => {
    const graph = buildOverlayCompositeFilterGraph([
      panel({ startInSeconds: 12, endInSeconds: 20 }),
    ])!;

    expect(graph).toContain(
      ":eval=frame:enable='between(t,12.000000,20.000000)'"
    );
  });

  it("crops to the kind's own default Transform, which nobody authored", () => {
    const graph = buildOverlayCompositeFilterGraph([panel()])!;

    // Centred (scale 1, origin 0.5/0.5) to right-shifted and slightly up.
    expect(graph).toContain("st(3,lerp(1.000000,1.300000,ld(2)))");
    expect(graph).toContain("(iw-iw/ld(3))*lerp(0.500000,0.620000,ld(2))");
    expect(graph).toContain("(ih-ih/ld(3))*lerp(0.500000,0.400000,ld(2))");
    // Clip Zoom's own crop arithmetic, so the two cannot disagree on framing.
    expect(graph).toContain("crop=w='");
    expect(graph).toContain("iw/ld(3)'");
    expect(graph).toContain("ih/ld(3)'");
  });

  it("puts the frame back to the export's own size once it has moved", () => {
    expect(buildOverlayCompositeFilterGraph([panel()])!).toContain(
      ",scale=1920:1080[tf0]"
    );
  });

  it("eases in and out over the same span at both ends", () => {
    const graph = buildOverlayCompositeFilterGraph([panel()])!;

    expect(graph).toContain(`clip((t-1.500000)/${EASE},0,1)`);
    expect(graph).toContain(`clip((4.500000-t)/${EASE},0,1)`);
    // Eased, not linear: the sampled curve is past a third of the way there
    // by an eighth of the ramp.
    expect(graph).toContain("lerp(0.000000,0.136888,");
    expect(graph).toContain("lerp(0.136888,0.408511,");
  });

  it("splits what it has when the Overlay is shorter than two eases", () => {
    const graph = buildOverlayCompositeFilterGraph([
      panel({ startInSeconds: 0, endInSeconds: 0.4 }),
    ])!;

    expect(graph).toContain("clip((t-0.000000)/0.200000,0,1)");
    expect(graph).toContain("clip((0.400000-t)/0.200000,0,1)");
  });

  it("cuts into the shifted framing when the enter animation is off", () => {
    const graph = buildOverlayCompositeFilterGraph([
      panel({ disableEnterAnimation: true }),
    ])!;

    // No ramp at the start at all — the camera is already there — while the
    // exit still eases.
    expect(graph).toContain(`min(1.000000,clip((4.500000-t)/${EASE},0,1))`);
    expect(graph).not.toContain("clip((t-1.500000)");
  });

  it("cuts out of it when the exit animation is off", () => {
    const graph = buildOverlayCompositeFilterGraph([
      panel({ disableExitAnimation: true }),
    ])!;

    expect(graph).toContain(`min(clip((t-1.500000)/${EASE},0,1),1.000000)`);
    expect(graph).not.toContain("clip((4.500000-t)");
  });

  it("holds one framing throughout when both are off", () => {
    const graph = buildOverlayCompositeFilterGraph([
      panel({ disableEnterAnimation: true, disableExitAnimation: true }),
    ])!;

    // Progress is pinned at 1: a hard cut to the shifted framing at the start
    // of the window and a hard cut back at the end, done by the gate alone.
    expect(graph).toContain("st(2,1.000000);");
    expect(graph).not.toContain("clip(");
    expect(graph).not.toContain("lerp(0.000000,0.136888,");
  });

  it("moves the camera only for the Overlays whose kind asks for it", () => {
    const graph = buildOverlayCompositeFilterGraph([
      panel({ kind: "definitionCard", startInSeconds: 1, endInSeconds: 2 }),
      panel({ startInSeconds: 10, endInSeconds: 14 }),
    ])!;

    // One crop, for the second Overlay, and the whole graphic chain runs off
    // its output — the Definition Card is drawn on untouched footage because
    // the crop is bypassed everywhere outside 10s..14s.
    expect(graph.match(/crop=/g)).toHaveLength(1);
    expect(graph).toContain("[0:v]crop=");
    expect(graph).toContain("[tf1][ovl0]overlay=");
    expect(graph).toContain("[comp0][ovl1]overlay=");
    expect(graph.match(/scale=1920:1080/g)).toHaveLength(1);
  });

  it("spells every number so ffmpeg's expression parser cannot misread it", () => {
    const graph = buildOverlayCompositeFilterGraph([
      panel({ startInSeconds: 0.0000001, endInSeconds: 1234567.5 }),
    ])!;

    expect(graph).not.toMatch(/e[+-]\d/);
  });
});

describe("buildOverlayCompositeArgs", () => {
  const card = {
    overlayPath: "/cache/a.mov",
    startInSeconds: 1,
    endInSeconds: 4,
    kind: "definitionCard",
    disableEnterAnimation: false,
    disableExitAnimation: false,
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
