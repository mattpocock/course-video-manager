import { describe, expect, it } from "vitest";
import { buildAnimaticChapterLayout } from "./animatic-chapters";
import {
  areAllChaptersCollapsed,
  hiddenRowIndices,
  toggleAllChapters,
  toggleChapter,
} from "./animatic-collapse";
import {
  buildAnimaticTimeline,
  type AnimaticClipMockup,
} from "./animatic-timeline";

/**
 * Which Chapters are folded away, given a click. State in, state out — so it is
 * tested straight: no jsdom, no Remotion, no player. NOTHING HERE READS THE
 * PLAYHEAD: a fold is opened by hand alone, and the Animatic plays through a
 * folded Chapter without touching it.
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
 * Two Chapters of two rows each, with one plain row above the first divider:
 * row 0 is that leading row, rows 1 and 2 sit under `ch_a`, rows 3 and 4 under
 * `ch_b`.
 */
const sections = buildAnimaticChapterLayout({
  segments: buildAnimaticTimeline([
    mockup(1, "a0"),
    mockup(2, "b0"),
    mockup(3, "b1"),
    mockup(4, "c0"),
    mockup(5, "c1"),
  ]).segments,
  chapters: [
    { id: "ch_a", name: "Setup", order: "a5" },
    { id: "ch_b", name: "Payoff", order: "b5" },
  ],
}).sections;

const chapterIds = sections.map((section) => section.chapter.id);

describe("folding one Chapter away", () => {
  it("closes it, and leaves every other Chapter as it was", () => {
    const collapsed = toggleChapter({ ch_b: true }, "ch_a");

    expect(collapsed).toEqual({ ch_a: true, ch_b: true });
  });

  it("opens a closed one again", () => {
    expect(toggleChapter({ ch_a: true, ch_b: true }, "ch_a")).toEqual({
      ch_a: false,
      ch_b: true,
    });
  });
});

describe("the one control for the lot", () => {
  it("folds every Chapter away while any is open", () => {
    expect(toggleAllChapters({ ch_a: true }, chapterIds)).toEqual({
      ch_a: true,
      ch_b: true,
    });
  });

  it("opens every Chapter once all are closed", () => {
    expect(toggleAllChapters({ ch_a: true, ch_b: true }, chapterIds)).toEqual({
      ch_a: false,
      ch_b: false,
    });
  });
});

describe("what the control's icon says it will do", () => {
  it("reads as 'collapse' while one Chapter is still open", () => {
    expect(areAllChaptersCollapsed({ ch_a: true }, chapterIds)).toBe(false);
  });

  it("reads as 'expand' once all are closed", () => {
    expect(
      areAllChaptersCollapsed({ ch_a: true, ch_b: true }, chapterIds)
    ).toBe(true);
  });

  it("is never 'expand' on a Video with no Chapters, which has no control", () => {
    expect(areAllChaptersCollapsed({}, [])).toBe(false);
  });
});

describe("the rows a fold takes off the screen", () => {
  it("names the indices under a folded Chapter, and nothing else", () => {
    expect(hiddenRowIndices({ collapsed: { ch_a: true }, sections })).toEqual(
      new Set([1, 2])
    );
  });

  it("hides no row while every Chapter is open", () => {
    expect(hiddenRowIndices({ collapsed: {}, sections }).size).toBe(0);
    expect(
      hiddenRowIndices({ collapsed: { ch_a: false, ch_b: false }, sections })
        .size
    ).toBe(0);
  });

  it("never hides a row above the first divider, whatever is folded", () => {
    const hidden = hiddenRowIndices({
      collapsed: { ch_a: true, ch_b: true },
      sections,
    });

    // Row 0 is the leading row: it belongs to no Chapter, so no fold reaches it.
    expect(hidden.has(0)).toBe(false);
    expect(hidden).toEqual(new Set([1, 2, 3, 4]));
  });
});
