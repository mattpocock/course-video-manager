import { describe, expect, it } from "vitest";
import {
  clampOverlayAnchor,
  retimeShift,
  shiftOverlayAnchors,
  shiftTranscriptWords,
} from "./retime-cascade.js";

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

  it("drops a word pushed off the front of the Clip", () => {
    // "the" spans 0.5-1.5; trimming 2s off the head puts it at -1.5 to -0.5,
    // which is footage the Clip no longer contains.
    const shifted = shiftTranscriptWords(words, { delta: -2, newDuration: 8 });

    expect(shifted.map((w) => w.text)).not.toContain("the");
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

  it("leaves a word untouched when nothing about the cut moved", () => {
    expect(shiftTranscriptWords(words, { delta: 0, newDuration: 10 })).toEqual(
      words
    );
  });

  it("keeps no words at all for a Clip with no room left", () => {
    expect(shiftTranscriptWords(words, { delta: 0, newDuration: 0 })).toEqual(
      []
    );
  });

  it("does not mutate the words it was given", () => {
    const original = [word(2, 3, "quick")];
    shiftTranscriptWords(original, { delta: -1, newDuration: 9 });

    expect(original).toEqual([word(2, 3, "quick")]);
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

  it("is idempotent — clamping an already-clamped anchor does nothing", () => {
    const shift = { delta: 0, newDuration: 4 };
    const once = clampOverlayAnchor(9, shift);

    expect(clampOverlayAnchor(once, shift)).toBe(once);
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
