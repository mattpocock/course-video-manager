import { describe, expect, it } from "vitest";
import { buildAnimaticChapterLayout } from "./animatic-chapters";
import {
  chapterProgressAtFrame,
  mockupProgressAtFrame,
  progressFillStyle,
  sectionAtIndex,
} from "./animatic-progress";
import {
  buildAnimaticTimeline,
  type AnimaticClipMockup,
} from "./animatic-timeline";

/**
 * The fill of the playing row and of a folded Chapter. Frames in, a fraction
 * out — so it is tested straight: no jsdom, no Remotion, no player.
 */

const mockup = (position: number, order: string): AnimaticClipMockup => ({
  id: `cm_${position}`,
  line: `Line ${position}.`,
  position,
  durationSeconds: 3,
  order,
  imageUrl: `/api/clip-mockups/cm_${position}/image`,
  audioUrl: `/api/clip-mockups/cm_${position}/audio`,
  imageMissing: false,
  audioMissing: false,
});

/**
 * One plain row above the first divider, then two Chapters of two rows: row 0
 * is leading, rows 1 and 2 are `ch_a`, rows 3 and 4 are `ch_b`.
 */
const mockups = [
  mockup(1, "a0"),
  mockup(2, "b0"),
  mockup(3, "b1"),
  mockup(4, "c0"),
  mockup(5, "c1"),
];

const { segments } = buildAnimaticTimeline(mockups);

const { sections } = buildAnimaticChapterLayout({
  segments,
  chapters: [
    { id: "ch_a", name: "Setup", order: "a5" },
    { id: "ch_b", name: "Payoff", order: "b5" },
  ],
});

/** Every row here is three seconds of speech plus the gap. */
const rowFrames = segments[0]!.durationInFrames;

describe("the playing Clip Mockup's fill", () => {
  it("is empty on its own first frame and full on its last", () => {
    const segment = segments[2]!;

    expect(
      mockupProgressAtFrame({
        segments,
        activeIndex: 2,
        frame: segment.startFrame,
      })
    ).toBe(0);
    expect(
      mockupProgressAtFrame({
        segments,
        activeIndex: 2,
        frame: segment.startFrame + segment.durationInFrames,
      })
    ).toBe(1);
  });

  it("is measured across the gap too, so it does not sit full while one plays out", () => {
    const segment = segments[0]!;
    const atEndOfSpeech = mockupProgressAtFrame({
      segments,
      activeIndex: 0,
      frame: segment.startFrame + segment.speechInFrames,
    });

    expect(atEndOfSpeech).toBeGreaterThan(0.9);
    expect(atEndOfSpeech).toBeLessThan(1);
  });

  it("is empty when nothing is playing", () => {
    expect(mockupProgressAtFrame({ segments, activeIndex: -1, frame: 0 })).toBe(
      0
    );
  });
});

describe("a Chapter's fill", () => {
  it("spans every row under the title, not just the one being heard", () => {
    const section = sections[0]!;
    const start = section.rows[0]!.segment.startFrame;

    // Halfway through its first row is a quarter of a two-row Chapter.
    expect(
      chapterProgressAtFrame({ section, frame: start + rowFrames / 2 })
    ).toBeCloseTo(0.25);
    expect(
      chapterProgressAtFrame({ section, frame: start + rowFrames })
    ).toBeCloseTo(0.5);
  });

  it("clamps outside its own span, so a Chapter behind the playhead reads full and one ahead reads empty", () => {
    const section = sections[1]!;

    expect(chapterProgressAtFrame({ section, frame: 0 })).toBe(0);
    expect(
      chapterProgressAtFrame({ section, frame: Number.MAX_SAFE_INTEGER })
    ).toBe(1);
  });

  it("is empty for a Chapter with nothing under it", () => {
    const empty = buildAnimaticChapterLayout({
      segments,
      chapters: [{ id: "ch_z", name: "Empty", order: "z0" }],
    }).sections[0]!;

    expect(chapterProgressAtFrame({ section: empty, frame: 500 })).toBe(0);
  });
});

describe("the Chapter the playhead is in", () => {
  it("is the one whose rows hold the playing index", () => {
    expect(sectionAtIndex({ sections, activeIndex: 3 })?.chapter.id).toBe(
      "ch_b"
    );
  });

  it("is nothing for a row above the first divider, and nothing while nothing plays", () => {
    expect(sectionAtIndex({ sections, activeIndex: 0 })).toBeUndefined();
    expect(sectionAtIndex({ sections, activeIndex: -1 })).toBeUndefined();
  });
});

describe("the bar's own CSS", () => {
  it("is a share of whatever it is drawn inside, and zero before a frame is written", () => {
    expect(progressFillStyle("--x")).toEqual({
      width: "calc(var(--x, 0) * 100%)",
    });
  });
});
