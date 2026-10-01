import { describe, expect, it } from "vitest";
import {
  buildVideoChapters,
  buildVideoChaptersFromRows,
  toYouTubeChapters,
  type ChapterTimelineItem,
} from "./video-chapters";

const clip = (order: string, duration: number) => ({
  order,
  sourceStartTime: 0,
  sourceEndTime: duration,
});
const chapter = (order: string, name: string) => ({ order, name });

describe("buildVideoChaptersFromRows", () => {
  it("returns no chapters when the Video has no Chapters", () => {
    expect(buildVideoChaptersFromRows([clip("a0", 10)], [])).toEqual([]);
  });

  it("returns no chapters when every Chapter is empty", () => {
    // Two Chapters back-to-back with no Clips below them.
    expect(
      buildVideoChaptersFromRows(
        [clip("a0", 5)],
        [chapter("a1", "A"), chapter("a2", "B")]
      )
    ).toEqual([]);
  });

  it("starts each Chapter at the floored sum of the Clip durations above it", () => {
    const result = buildVideoChaptersFromRows(
      [clip("a0", 22.4), clip("a2", 13.9), clip("a4", 44.2)],
      [chapter("a1", "First topic"), chapter("a3", "Next topic")]
    );
    expect(result).toEqual([
      { title: "Intro", startTime: 0 },
      { title: "First topic", startTime: 22 },
      { title: "Next topic", startTime: 36 },
    ]);
  });

  it("puts rows into timeline order by their order key, whatever order they arrive in", () => {
    const result = buildVideoChaptersFromRows(
      [clip("a3", 20), clip("a1", 10)],
      [chapter("a2", "Second"), chapter("a0", "First")]
    );
    expect(result).toEqual([
      { title: "First", startTime: 0 },
      { title: "Second", startTime: 10 },
    ]);
  });

  it("orders by byte value, not by locale (Zz sorts before a0)", () => {
    const result = buildVideoChaptersFromRows(
      [clip("a0", 10)],
      [chapter("Zz", "Opening")]
    );
    expect(result).toEqual([{ title: "Opening", startTime: 0 }]);
  });

  it("adds an Intro Chapter at 0:00 when the first Chapter starts later", () => {
    const result = buildVideoChaptersFromRows(
      [clip("a0", 10), clip("a2", 10)],
      [chapter("a1", "Second segment")]
    );
    expect(result).toEqual([
      { title: "Intro", startTime: 0 },
      { title: "Second segment", startTime: 10 },
    ]);
  });

  it("adds no Intro when the first Chapter already starts at 0:00", () => {
    const result = buildVideoChaptersFromRows(
      [clip("a1", 10), clip("a2", 5)],
      [chapter("a0", "Welcome")]
    );
    expect(result).toEqual([{ title: "Welcome", startTime: 0 }]);
  });

  it("drops an empty Chapter between two kept ones", () => {
    // Chapter B has no Clips before C, so B is empty.
    const result = buildVideoChaptersFromRows(
      [clip("a1", 10), clip("a4", 5)],
      [chapter("a0", "A"), chapter("a2", "B"), chapter("a3", "C")]
    );
    expect(result).toEqual([
      { title: "A", startTime: 0 },
      { title: "C", startTime: 10 },
    ]);
  });

  it("drops an empty Chapter at the end of the Video", () => {
    const result = buildVideoChaptersFromRows(
      [clip("a0", 10), clip("a2", 5)],
      [chapter("a1", "Middle"), chapter("a3", "Trailing")]
    );
    expect(result).toEqual([
      { title: "Intro", startTime: 0 },
      { title: "Middle", startTime: 10 },
    ]);
  });
});

describe("toYouTubeChapters", () => {
  it("writes each start time as M:SS", () => {
    expect(
      toYouTubeChapters([
        { title: "Intro", startTime: 0 },
        { title: "Setup", startTime: 65 },
        { title: "Long one", startTime: 3725 },
      ])
    ).toEqual([
      { timestamp: "0:00", name: "Intro" },
      { timestamp: "1:05", name: "Setup" },
      { timestamp: "62:05", name: "Long one" },
    ]);
  });
});

describe("the editor timeline and the database rows agree", () => {
  // The video editor (Copy YouTube chapters) hands over its items already in
  // timeline order; publish and the AI writer hand over rows with order keys.
  // Both must give the same chapter list, or a copied YouTube description
  // would not match the published course.
  it("gives the same chapters for the same Video", () => {
    const clips = [
      clip("a5", 4),
      clip("a1", 12.7),
      clip("a3", 30.2),
      clip("a6", 8),
    ];
    const chapters = [
      chapter("a2", "Setup"),
      chapter("a4", "Empty"),
      chapter("a4V", "Build"),
      chapter("a7", "Trailing"),
    ];

    const timeline: ChapterTimelineItem[] = [
      { kind: "clip", durationSeconds: 12.7 },
      { kind: "chapter", name: "Setup" },
      { kind: "clip", durationSeconds: 30.2 },
      { kind: "chapter", name: "Empty" },
      { kind: "chapter", name: "Build" },
      { kind: "clip", durationSeconds: 4 },
      { kind: "clip", durationSeconds: 8 },
      { kind: "chapter", name: "Trailing" },
    ];

    const published = buildVideoChaptersFromRows(clips, chapters);
    expect(buildVideoChapters(timeline)).toEqual(published);
    expect(toYouTubeChapters(published)).toEqual([
      { timestamp: "0:00", name: "Intro" },
      { timestamp: "0:12", name: "Setup" },
      { timestamp: "0:42", name: "Build" },
    ]);
  });
});
