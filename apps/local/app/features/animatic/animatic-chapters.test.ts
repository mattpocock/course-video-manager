import { describe, expect, it } from "vitest";
import {
  buildAnimaticChapterLayout,
  type AnimaticChapter,
} from "./animatic-chapters";
import {
  ANIMATIC_FPS,
  buildAnimaticTimeline,
  UNVOICED_HOLD_SECONDS,
  type AnimaticClipMockup,
} from "./animatic-timeline";

/**
 * Which rows fall under which divider, and what the divider says about them.
 * Rows in, groups out — the grouping is arithmetic over the shared `order`
 * space, so it is tested straight: no jsdom, no Remotion, no player.
 */

const mockup = (
  position: number,
  order: string,
  durationSeconds: number | null = 3
): AnimaticClipMockup => ({
  id: `cm_${position}`,
  line: `Line ${position}.`,
  position,
  durationSeconds,
  order,
  imageUrl: `/api/clip-mockups/cm_${position}/image`,
  audioUrl: `/api/clip-mockups/cm_${position}/audio`,
  imageMissing: false,
  audioMissing: false,
});

const chapter = (id: string, name: string, order: string): AnimaticChapter => ({
  id,
  name,
  order,
});

/** The layout of a Video, built the way the page builds it. */
const layoutOf = (
  mockups: readonly AnimaticClipMockup[],
  chapters: readonly AnimaticChapter[]
) =>
  buildAnimaticChapterLayout({
    segments: buildAnimaticTimeline(mockups).segments,
    chapters,
  });

const positionsOf = (
  rows: readonly { segment: { mockup: { position: number } } }[]
) => rows.map((row) => row.segment.mockup.position);

describe("a Video with no Chapters", () => {
  it("is one plain list, exactly the sidebar it had before Chapters existed", () => {
    const layout = layoutOf([mockup(1, "a0"), mockup(2, "a1")], []);

    expect(layout.sections).toEqual([]);
    expect(positionsOf(layout.leadingRows)).toEqual([1, 2]);
  });

  it("keeps each row's timeline index, so no key or highlight moves", () => {
    const layout = layoutOf([mockup(1, "a0"), mockup(2, "a1")], []);

    expect(layout.leadingRows.map((row) => row.index)).toEqual([0, 1]);
  });
});

describe("rows above the first Chapter", () => {
  it("stay plain rows, with no heading invented over them", () => {
    const layout = layoutOf(
      [mockup(1, "a0"), mockup(2, "a2"), mockup(3, "a3")],
      [chapter("cmc_1", "The setup", "a1")]
    );

    expect(positionsOf(layout.leadingRows)).toEqual([1]);
    expect(positionsOf(layout.sections[0]!.rows)).toEqual([2, 3]);
  });

  it("does not shift the indexes of the rows under the divider", () => {
    const layout = layoutOf(
      [mockup(1, "a0"), mockup(2, "a2")],
      [chapter("cmc_1", "The setup", "a1")]
    );

    expect(layout.sections[0]!.rows.map((row) => row.index)).toEqual([1]);
  });
});

describe("a Chapter's rolled-up line", () => {
  it("counts the rows between it and the next divider, and no others", () => {
    const layout = layoutOf(
      [mockup(1, "a2"), mockup(2, "a3"), mockup(3, "a5")],
      [
        chapter("cmc_1", "The setup", "a1"),
        chapter("cmc_2", "The payoff", "a4"),
      ]
    );

    expect(layout.sections.map((section) => section.mockupCount)).toEqual([
      2, 1,
    ]);
    expect(layout.sections.map((section) => section.chapter.name)).toEqual([
      "The setup",
      "The payoff",
    ]);
  });

  it("runs for as long as its own rows do, in the frames the player plays", () => {
    const mockups = [mockup(1, "a2", 4), mockup(2, "a3", 6)];
    const segments = buildAnimaticTimeline(mockups).segments;
    const layout = buildAnimaticChapterLayout({
      segments,
      chapters: [chapter("cmc_1", "The setup", "a1")],
    });

    expect(layout.sections[0]!.runTimeSeconds).toBe(
      (segments[0]!.durationInFrames + segments[1]!.durationInFrames) /
        ANIMATIC_FPS
    );
  });

  it("holds an unvoiced Clip Mockup for its floor, not for nothing", () => {
    const layout = layoutOf(
      [mockup(1, "a2", null)],
      [chapter("cmc_1", "The setup", "a1")]
    );

    expect(layout.sections[0]!.mockupCount).toBe(1);
    expect(layout.sections[0]!.runTimeSeconds).toBeGreaterThanOrEqual(
      UNVOICED_HOLD_SECONDS
    );
  });

  it("seeks to its first Clip Mockup's own first frame", () => {
    const mockups = [mockup(1, "a2", 4), mockup(2, "a4", 6)];
    const segments = buildAnimaticTimeline(mockups).segments;
    const layout = buildAnimaticChapterLayout({
      segments,
      chapters: [
        chapter("cmc_1", "The setup", "a1"),
        chapter("cmc_2", "The payoff", "a3"),
      ],
    });

    expect(layout.sections[0]!.seekFrame).toBe(segments[0]!.startFrame);
    expect(layout.sections[1]!.seekFrame).toBe(segments[1]!.startFrame);
    expect(layout.sections[1]!.seekIndex).toBe(1);
  });
});

describe("an empty Chapter", () => {
  it("reads as zero and offers nowhere to seek to", () => {
    const layout = layoutOf(
      [mockup(1, "a1"), mockup(2, "a2")],
      [
        chapter("cmc_1", "The setup", "a0"),
        chapter("cmc_2", "The payoff", "a9"),
      ]
    );

    const empty = layout.sections[1]!;
    expect(empty.rows).toEqual([]);
    expect(empty.mockupCount).toBe(0);
    expect(empty.runTimeSeconds).toBe(0);
    expect(empty.seekFrame).toBeNull();
    expect(empty.seekIndex).toBeNull();
  });

  it("does not swallow the rows of the Chapter above it", () => {
    const layout = layoutOf(
      [mockup(1, "a1")],
      [
        chapter("cmc_1", "The setup", "a0"),
        chapter("cmc_2", "The payoff", "a9"),
      ]
    );

    expect(positionsOf(layout.sections[0]!.rows)).toEqual([1]);
  });
});

describe("the whole sidebar", () => {
  it("shows every Clip Mockup exactly once, wherever the dividers fall", () => {
    const mockups = [
      mockup(1, "a0"),
      mockup(2, "a2"),
      mockup(3, "a3"),
      mockup(4, "a5"),
    ];
    const layout = layoutOf(mockups, [
      chapter("cmc_1", "The setup", "a1"),
      chapter("cmc_2", "The payoff", "a4"),
      chapter("cmc_3", "The outro", "a9"),
    ]);

    const shown = [
      ...positionsOf(layout.leadingRows),
      ...layout.sections.flatMap((section) => positionsOf(section.rows)),
    ];
    expect(shown).toEqual([1, 2, 3, 4]);
  });

  // `Zz` before `a0` is byte order, which is what the column's COLLATE "C" and
  // `compareOrderStrings` do; a locale sort puts them the other way round.
  it("reads the Chapters in byte order, whatever order they arrive in", () => {
    const layout = layoutOf(
      [mockup(1, "Zz5"), mockup(2, "a5")],
      [
        chapter("cmc_2", "The payoff", "a0"),
        chapter("cmc_1", "The setup", "Zz"),
      ]
    );

    expect(layout.sections.map((section) => section.chapter.name)).toEqual([
      "The setup",
      "The payoff",
    ]);
    expect(positionsOf(layout.sections[0]!.rows)).toEqual([1]);
  });
});
