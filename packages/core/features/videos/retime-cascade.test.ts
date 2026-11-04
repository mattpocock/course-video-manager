import { describe, expect, it } from "vitest";
import {
  clampOverlayAnchor,
  retimeShift,
  shiftFootageLayer,
  shiftOverlayAnchors,
  shiftTranscriptWords,
} from "./retime-cascade.js";
import type { ClipLayerSpec, FootageLayerSpec } from "./clip-layer.js";

// ===========================================================================
// The retiming cascade, as plain arithmetic — no DB, no Effect.
//
// The reference Clip throughout is cut 10s -> 20s out of its source file, so
// it is 10s long and a Clip-relative offset of `t` is source second `10 + t`.
// Every case below states which source second a word was spoken at, because
// that is the thing the cascade has to preserve.
// ===========================================================================

const CLIP = { sourceStartTime: 10, sourceEndTime: 20 };

const word = (start: number, end: number, text: string) => ({
  start,
  end,
  text,
});

describe("retimeShift", () => {
  it("reads the delta off the in-point, so a head trim shifts offsets back", () => {
    // Cut 2.5s off the head: a word at 4.0 was spoken at source 14.0, which is
    // now 1.5 into the Clip.
    expect(
      retimeShift(CLIP, { sourceStartTime: 12.5, sourceEndTime: 20 })
    ).toEqual({ delta: -2.5, newDuration: 7.5 });
  });

  it("extends offsets forward when the in-point moves earlier", () => {
    expect(
      retimeShift(CLIP, { sourceStartTime: 8, sourceEndTime: 20 })
    ).toEqual({
      delta: 2,
      newDuration: 12,
    });
  });

  it("leaves the delta at zero for a tail-only recut, but shrinks the room", () => {
    expect(
      retimeShift(CLIP, { sourceStartTime: 10, sourceEndTime: 15 })
    ).toEqual({
      delta: 0,
      newDuration: 5,
    });
  });
});

describe("shiftTranscriptWords", () => {
  const words = [
    word(0.5, 1.5, "the"),
    word(2, 3, "quick"),
    word(5, 6, "brown"),
    word(8.5, 9.5, "fox"),
  ];

  it("shifts every word by the delta, keeping its text", () => {
    const shifted = shiftTranscriptWords(words, {
      delta: -2,
      newDuration: 8,
    });

    expect(shifted).toEqual([
      word(0, 1, "quick"),
      word(3, 4, "brown"),
      word(6.5, 7.5, "fox"),
    ]);
  });

  it("drops a word that now runs past the Clip's end", () => {
    // Tail-only recut to 6s long: "fox" (8.5-9.5) no longer exists.
    const shifted = shiftTranscriptWords(words, { delta: 0, newDuration: 6 });

    expect(shifted.map((w) => w.text)).toEqual(["the", "quick", "brown"]);
  });

  it("drops a word only half inside the new bounds", () => {
    // "brown" spans 5-6; a Clip 5.5s long holds its start but not its end,
    // and there is no honest offset for half a spoken word.
    const shifted = shiftTranscriptWords(words, { delta: 0, newDuration: 5.5 });

    expect(shifted.map((w) => w.text)).toEqual(["the", "quick"]);
  });

  it("keeps a word mostly inside the new bounds, clamped to the edge", () => {
    // A Short's range ending at 5.6 cuts into "brown" (5-6), but 60% of it is
    // said inside the range, so it is captioned (#2670).
    const shifted = shiftTranscriptWords(words, { delta: 0, newDuration: 5.6 });

    expect(shifted.at(-1)).toEqual(word(5, 5.6, "brown"));
  });

  it("keeps a word the in-point cuts into by most of it, from 0", () => {
    // In-point moved to source 15.4: "brown" (source 15-16) is 60% inside.
    const shifted = shiftTranscriptWords(words, {
      delta: -5.4,
      newDuration: 4.6,
    });

    expect(shifted[0]!.text).toBe("brown");
    expect(shifted[0]!.start).toBe(0);
    expect(shifted[0]!.end).toBeCloseTo(0.6);
  });

  it("keeps a word the cut lands within the edge tolerance of", () => {
    // "a" spans 5-5.2; a range ending at 5.05 holds only a quarter of it,
    // but cuts within 0.15s of its end, inside Whisper's slop.
    const short = [word(4, 4.8, "is"), word(5, 5.2, "a")];

    const shifted = shiftTranscriptWords(short, {
      delta: 0,
      newDuration: 5.05,
    });

    expect(shifted.map((w) => w.text)).toEqual(["is", "a"]);
  });

  it("drops a word wholly outside, however short", () => {
    const short = [word(4, 4.8, "is"), word(5, 5.1, "a")];

    const shifted = shiftTranscriptWords(short, { delta: 0, newDuration: 5 });

    expect(shifted.map((w) => w.text)).toEqual(["is"]);
  });

  it("keeps a word ending exactly at the Clip's last instant", () => {
    const shifted = shiftTranscriptWords(words, { delta: 0, newDuration: 6 });

    expect(shifted.at(-1)).toEqual(word(5, 6, "brown"));
  });

  it("keeps a word starting exactly at the Clip's first instant", () => {
    const shifted = shiftTranscriptWords(words, {
      delta: -0.5,
      newDuration: 9.5,
    });

    expect(shifted[0]).toEqual(word(0, 1, "the"));
  });

  it("keeps no words at all for a Clip with no room left", () => {
    expect(shiftTranscriptWords(words, { delta: 0, newDuration: 0 })).toEqual(
      []
    );
  });
});

describe("clampOverlayAnchor", () => {
  it("shifts an in-bounds anchor and nothing more", () => {
    expect(clampOverlayAnchor(6, { delta: -2, newDuration: 8 })).toBe(4);
  });

  it("clamps an anchor pushed before the Clip's start back to 0", () => {
    expect(clampOverlayAnchor(1, { delta: -3, newDuration: 7 })).toBe(0);
  });

  it("clamps an anchor pushed past the Clip's end back to its last moment", () => {
    // The Clip's end IS the Video's last frame when this is the final Clip,
    // and is strictly before it otherwise — either way the anchor stays on the
    // Video's timeline.
    expect(clampOverlayAnchor(9, { delta: 0, newDuration: 4 })).toBe(4);
  });

  it("collapses to 0 for a Clip with no room at all", () => {
    expect(clampOverlayAnchor(9, { delta: 0, newDuration: 0 })).toBe(0);
  });
});

describe("shiftOverlayAnchors", () => {
  it("reports only the anchors that actually moved", () => {
    const overlays = [
      { id: "ov_head", at: 1 },
      { id: "ov_mid", at: 5 },
      { id: "ov_tail", at: 9 },
    ];

    expect(
      shiftOverlayAnchors(overlays, { delta: -2, newDuration: 8 })
    ).toEqual([
      { id: "ov_head", at: 0 },
      { id: "ov_mid", at: 3 },
      { id: "ov_tail", at: 7 },
    ]);
  });

  it("reports nothing when the recut leaves every anchor where it was", () => {
    const overlays = [{ id: "ov_mid", at: 5 }];

    expect(shiftOverlayAnchors(overlays, { delta: 0, newDuration: 8 })).toEqual(
      []
    );
  });

  it("never drops an Overlay, however far out of bounds it lands", () => {
    const overlays = [
      { id: "ov_head", at: 0.5 },
      { id: "ov_tail", at: 40 },
    ];

    expect(
      shiftOverlayAnchors(overlays, { delta: -5, newDuration: 3 })
    ).toEqual([
      { id: "ov_head", at: 0 },
      { id: "ov_tail", at: 3 },
    ]);
  });

  it("carries no content — only an id and an offset can be written back", () => {
    const overlays = [
      { id: "ov_mid", at: 5, title: "Hydration", description: "..." },
    ];

    expect(
      shiftOverlayAnchors(overlays, { delta: -1, newDuration: 8 })
    ).toEqual([{ id: "ov_mid", at: 4 }]);
  });
});

describe("shiftFootageLayer", () => {
  // 10s -> 20s recut to 12s -> 20s: delta -2, 8s long.
  const trim = retimeShift(
    { sourceStartTime: 10, sourceEndTime: 20 },
    { sourceStartTime: 12, sourceEndTime: 20 }
  );
  const layer = (
    span: { at: number; duration: number } | null,
    start = 5
  ): FootageLayerSpec => ({
    kind: "footage",
    source: { kind: "file", path: "raw-footage/imported/b.mp4", start },
    sourceCrop: { x: 0, y: 0, w: 1, h: 1 },
    placement: { x: 0, y: 0, w: 1920, h: 1080 },
    volume: 0,
    span,
  });

  it("moves a whole-Clip Layer's start on with the in-point", () => {
    expect(shiftFootageLayer(layer(null), trim)).toEqual(layer(null, 7));
  });

  it("moves a span with the source", () => {
    expect(shiftFootageLayer(layer({ at: 3, duration: 2 }), trim)).toEqual(
      layer({ at: 1, duration: 2 })
    );
  });

  it("cuts the head of a span the new in-point passes, its start moving on", () => {
    expect(shiftFootageLayer(layer({ at: 1, duration: 4 }), trim)).toEqual(
      layer({ at: 0, duration: 3 }, 6)
    );
  });

  it("clamps a span the recut leaves no part of, never deleting it", () => {
    expect(shiftFootageLayer(layer({ at: 0, duration: 1 }), trim)).toEqual(
      layer({ at: 0, duration: 1 })
    );
  });

  it("never moves a Scene Layer or the Clip's own session file", () => {
    const camera: ClipLayerSpec = {
      ...layer(null),
      source: { kind: "session", file: "camera" },
    };
    expect(shiftFootageLayer(camera, trim)).toBe(camera);
    const scene: ClipLayerSpec = { kind: "scene", volume: 1 };
    expect(shiftFootageLayer(scene, trim)).toBe(scene);
  });
});
