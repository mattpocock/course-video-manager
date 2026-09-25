import { describe, expect, it } from "vitest";
import { buildAnimaticChapterLayout } from "./animatic-chapters";
import {
  areAllChaptersCollapsed,
  expandChapterAtPlayhead,
  toggleAllChapters,
  toggleChapter,
  type AnimaticCollapseState,
} from "./animatic-collapse";
import {
  buildAnimaticTimeline,
  type AnimaticClipMockup,
} from "./animatic-timeline";

/**
 * Which Chapters are folded away, given a click or given the playhead. State in,
 * state out — so it is tested straight: no jsdom, no Remotion, no player.
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

describe("the playhead entering a folded Chapter", () => {
  it("opens it, so the list never hides the row being heard", () => {
    // Index 3 is the first row of `ch_b`.
    const collapsed = expandChapterAtPlayhead({
      collapsed: { ch_a: true, ch_b: true },
      sections,
      activeIndex: 3,
    });

    expect(collapsed).toEqual({ ch_a: true, ch_b: false });
  });

  it("leaves the state untouched when the playing Chapter is already open", () => {
    const before: AnimaticCollapseState = { ch_a: true };
    const after = expandChapterAtPlayhead({
      collapsed: before,
      sections,
      activeIndex: 3,
    });

    // The SAME state, so the effect asks React for no re-render.
    expect(after).toBe(before);
  });

  it("leaves the state untouched for a row above the first divider", () => {
    const before: AnimaticCollapseState = { ch_a: true, ch_b: true };

    expect(
      expandChapterAtPlayhead({ collapsed: before, sections, activeIndex: 0 })
    ).toBe(before);
  });

  it("leaves the state untouched when nothing plays", () => {
    const before: AnimaticCollapseState = { ch_a: true, ch_b: true };

    expect(
      expandChapterAtPlayhead({ collapsed: before, sections, activeIndex: -1 })
    ).toBe(before);
  });
});
