import { describe, expect, it } from "vitest";
import { planClipSplit, splitClipLayers } from "./clip-split.js";
import type { ClipLayerSpec, FootageLayerSpec } from "./clip-layer.js";

// The reference Clip is cut 10s -> 20s out of its source file, so source
// second `10 + t` is Clip-relative `t`.
const CLIP = {
  sourceStartTime: 10,
  sourceEndTime: 20,
  text: "The quick, brown fox.",
};

const word = (start: number, end: number, text: string) => ({
  start,
  end,
  text,
});

const WORDS = [
  word(0.5, 1.5, "The"),
  word(2, 3, "quick,"),
  word(5, 6, "brown"),
  word(8.5, 9.5, "fox."),
];

describe("planClipSplit", () => {
  it("snaps a cut inside a word to its nearer edge, and splits words and text there", () => {
    // Source 15.3 is 0.3s into "brown" (5-6): its start is nearer.
    const plan = planClipSplit(CLIP, WORDS, { kind: "source", seconds: 15.3 });

    expect(plan).toEqual({
      cut: 5,
      left: { text: "The quick,", words: [WORDS[0], WORDS[1]] },
      right: {
        text: "brown fox.",
        words: [word(0, 1, "brown"), word(3.5, 4.5, "fox.")],
      },
    });
  });

  it("leaves a cut in the silence between two words where it is", () => {
    const plan = planClipSplit(CLIP, WORDS, { kind: "source", seconds: 14 });

    expect(plan).toMatchObject({ cut: 4, left: { text: "The quick," } });
  });

  it("cuts midway through the silence before word n", () => {
    const plan = planClipSplit(CLIP, WORDS, { kind: "word", index: 3 });

    expect(plan).toMatchObject({
      cut: 7.25,
      left: { text: "The quick, brown" },
      right: { text: "fox.", words: [word(1.25, 2.25, "fox.")] },
    });
  });

  it("refuses a cut that leaves either side empty", () => {
    expect(
      planClipSplit(CLIP, WORDS, { kind: "source", seconds: 20 })
    ).toHaveProperty("problem");
    expect(
      planClipSplit(CLIP, WORDS, { kind: "word", index: 0 })
    ).toHaveProperty("problem");
    expect(
      planClipSplit(CLIP, WORDS, { kind: "word", index: 4 })
    ).toHaveProperty("problem");
  });

  it("refuses a side shorter than the minimum Clip length", () => {
    // "The" ends at 1.5, so word 1 cuts at 1.75: too short a left side for 2s.
    expect(
      planClipSplit(
        CLIP,
        WORDS,
        { kind: "word", index: 1 },
        { minimumSeconds: 2 }
      )
    ).toHaveProperty("problem");
  });

  it("cuts a Clip with no words where asked, its text shared out by letter count", () => {
    const plan = planClipSplit(CLIP, [], { kind: "source", seconds: 15.3 });

    // 53% of the 16 letters is 8.5: "The quick," has 8.
    expect(plan).toEqual({
      cut: expect.closeTo(5.3) as unknown,
      left: { text: "The quick,", words: [] },
      right: { text: "brown fox.", words: [] },
    });
  });
});

describe("splitClipLayers", () => {
  const fileLayer = (
    span: FootageLayerSpec["span"],
    start = 30
  ): FootageLayerSpec => ({
    kind: "footage",
    source: { kind: "file", path: "broll.mp4", start },
    sourceCrop: { x: 0, y: 0, w: 1, h: 1 },
    placement: { x: 0, y: 0, w: 1080, h: 1920 },
    volume: 0,
    span,
  });
  const scene: ClipLayerSpec = { kind: "scene", volume: 1 };

  it("copies whole-Clip Layers to both sides, a file's start moving on for the right", () => {
    expect(splitClipLayers([scene, fileLayer(null)], 4)).toEqual({
      left: [scene, fileLayer(null)],
      right: [scene, fileLayer(null, 34)],
    });
  });

  it("gives a span to the side it covers, trimmed at the cut", () => {
    const before = fileLayer({ at: 1, duration: 2 });
    const across = fileLayer({ at: 3, duration: 2 });
    const after = fileLayer({ at: 6, duration: 1 });

    expect(splitClipLayers([scene, before, across, after], 4)).toEqual({
      left: [scene, before, fileLayer({ at: 3, duration: 1 })],
      right: [
        scene,
        fileLayer({ at: 0, duration: 1 }, 31),
        fileLayer({ at: 2, duration: 1 }),
      ],
    });
  });

  it("refuses a split that leaves a side with no Layer", () => {
    expect(
      splitClipLayers([fileLayer({ at: 0, duration: 2 })], 4)
    ).toHaveProperty("problem");
  });
});
