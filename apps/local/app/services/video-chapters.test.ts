import { describe, expect, it } from "vitest";
import {
  buildVideoChapters,
  buildVideoChaptersFromRows,
  toYouTubeChapters,
  type ChapterTimelineItem,
} from "./video-chapters";
import {
  exportedClipSecondsIn,
  LONG_PAUSE_DURATION_IN_SECONDS,
} from "./export-duration-check";
import { obsClipRow, recorderClipRow } from "@/test-utils/source-clip-rows";

const clip = (
  order: string,
  duration: number,
  pauseType: string | null = "none"
) => ({ ...obsClipRow(duration), order, pauseType });
const recorderClip = (order: string, duration: number) => ({
  ...recorderClipRow(duration),
  order,
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

  // The export appends LONG_PAUSE_DURATION_IN_SECONDS (0.18 s) to every Clip
  // whose Pause Type is "long", so the Chapters after it start that much later
  // in the exported file. Ten long Pauses would otherwise put a Chapter 1.8 s
  // early.
  it("counts the long Pause the export adds to a Clip, as the export does", () => {
    const longPauses = Array.from({ length: 10 }, (_, i) =>
      clip(`a${i}`, 1, "long")
    );
    const result = buildVideoChaptersFromRows(
      [...longPauses, clip("b1", 5)],
      [chapter("b0", "After the pauses")]
    );
    // 10 × (1 + 0.18) = 11.8 → 11, where source time alone says 10.
    expect(result).toEqual([
      { title: "Intro", startTime: 0 },
      { title: "After the pauses", startTime: 11 },
    ]);
  });

  it("times a Video exported Clip by Clip in whole 60 fps frames: 120 × 1.005 s Clips (61 frames each) end at 122 s, not 120.6 s", () => {
    const clips = Array.from({ length: 120 }, (_, i) =>
      recorderClip(`a${String(i).padStart(3, "0")}`, 1.005)
    );
    const result = buildVideoChaptersFromRows(
      [...clips, recorderClip("b1", 5)],
      [chapter("b0", "After 120 Clips")]
    );
    expect(result).toEqual([
      { title: "Intro", startTime: 0 },
      { title: "After 120 Clips", startTime: 122 },
    ]);
  });

  it("adds nothing for any Pause Type but long", () => {
    const result = buildVideoChaptersFromRows(
      [clip("a0", 10, null), clip("a1", 10, "short"), clip("a3", 5)],
      [chapter("a2", "Third")]
    );
    expect(result).toEqual([
      { title: "Intro", startTime: 0 },
      { title: "Third", startTime: 20 },
    ]);
  });
});

describe("exportedClipSecondsIn", () => {
  it("is the source span, plus the long Pause for a long-Pause Clip", () => {
    const span = { ...obsClipRow(10), sourceStartTime: 3 };
    const plain = { ...span, pauseType: "none" };
    const paused = { ...span, pauseType: "long" };
    const secondsOf = exportedClipSecondsIn([plain, paused]);
    expect(secondsOf(plain)).toBe(7);
    expect(secondsOf(paused)).toBeCloseTo(7 + LONG_PAUSE_DURATION_IN_SECONDS);
  });
});

describe("toYouTubeChapters", () => {
  it("writes each start time as m:ss, growing an hours field past the hour", () => {
    expect(
      toYouTubeChapters([
        { title: "Intro", startTime: 0 },
        { title: "Setup", startTime: 65 },
        { title: "Long one", startTime: 3725 },
      ])
    ).toEqual([
      { timestamp: "0:00", name: "Intro" },
      { timestamp: "1:05", name: "Setup" },
      { timestamp: "1:02:05", name: "Long one" },
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
