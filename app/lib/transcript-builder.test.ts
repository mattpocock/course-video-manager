import { describe, it, expect } from "vitest";
import {
  buildTranscript,
  formatProseTranscript,
  toDiffArray,
  toTranscriptItems,
} from "./transcript-builder";
import type { ClipInput, ChapterInput } from "./transcript-builder";

const makeClip = (
  order: string,
  text: string | null,
  overrides?: Partial<ClipInput>
): ClipInput => ({
  order,
  text,
  sourceStartTime: 0,
  sourceEndTime: 1,
  videoFilename: "video.mp4",
  ...overrides,
});

const makeSection = (
  id: string,
  order: string,
  name: string
): ChapterInput => ({ id, order, name });

describe("buildTranscript", () => {
  it("returns empty results for empty inputs", () => {
    const result = buildTranscript([], []);
    expect(result.indexedClips).toEqual([]);
    expect(result.transcript).toBe("");
    expect(result.wordCount).toBe(0);
    expect(result.sections).toEqual([]);
  });

  it("produces flat transcript with sequential indices for clips only", () => {
    const clips = [
      makeClip("a0", "Hello world"),
      makeClip("a1", "Second clip here"),
    ];
    const result = buildTranscript(clips, []);

    expect(result.transcript).toBe("[1] Hello world [2] Second clip here");
    expect(result.indexedClips).toHaveLength(2);
    expect(result.indexedClips[0]!.index).toBe(1);
    expect(result.indexedClips[1]!.index).toBe(2);
    expect(result.sections).toEqual([]);
  });

  it("produces section headers with zero word counts for sections only", () => {
    const sections = [
      makeSection("s1", "a0", "Intro"),
      makeSection("s2", "a1", "Body"),
    ];
    const result = buildTranscript([], sections);

    expect(result.transcript).toBe("## Intro\n\n## Body");
    expect(result.indexedClips).toEqual([]);
    expect(result.sections).toEqual([
      { id: "s1", name: "Intro", order: "a0", wordCount: 0 },
      { id: "s2", name: "Body", order: "a1", wordCount: 0 },
    ]);
  });

  it("correctly interleaves clips and sections", () => {
    const clips = [
      makeClip("a1", "First clip"),
      makeClip("a3", "Second clip"),
      makeClip("a5", "Third clip"),
    ];
    const sections = [
      makeSection("s1", "a0", "Intro"),
      makeSection("s2", "a2", "Main"),
    ];
    const result = buildTranscript(clips, sections);

    expect(result.transcript).toBe(
      "## Intro\n\n[1] First clip\n\n## Main\n\n[2] Second clip [3] Third clip"
    );
    expect(result.indexedClips).toHaveLength(3);
    expect(result.sections[0]!.wordCount).toBe(2); // "First clip"
    expect(result.sections[1]!.wordCount).toBe(4); // "Second clip" + "Third clip"
  });

  it("includes clips with null text in indexedClips but skips in transcript", () => {
    const clips = [
      makeClip("a0", "Hello"),
      makeClip("a1", null),
      makeClip("a2", "World"),
    ];
    const result = buildTranscript(clips, []);

    expect(result.indexedClips).toHaveLength(3);
    expect(result.indexedClips[0]!.index).toBe(1);
    expect(result.indexedClips[1]!.index).toBe(2);
    expect(result.indexedClips[1]!.text).toBeNull();
    expect(result.indexedClips[2]!.index).toBe(3);
    // Null clip skipped in transcript text
    expect(result.transcript).toBe("[1] Hello [3] World");
  });

  it("synchronizes indexedClips indices with transcript markers", () => {
    const clips = [
      makeClip("a1", "Alpha"),
      makeClip("a3", null),
      makeClip("a5", "Beta"),
    ];
    const sections = [makeSection("s1", "a0", "Section")];
    const result = buildTranscript(clips, sections);

    // Index 2 clip has null text, so transcript should have [1] and [3]
    const markers = result.transcript.match(/\[(\d+)\]/g)!;
    expect(markers).toEqual(["[1]", "[3]"]);

    // indexedClips[0].index=1 matches [1], indexedClips[2].index=3 matches [3]
    expect(result.indexedClips[0]!.index).toBe(1);
    expect(result.indexedClips[2]!.index).toBe(3);
  });

  it("per-section word counts sum to total wordCount minus markdown overhead", () => {
    const clips = [
      makeClip("a1", "one two three"),
      makeClip("a3", "four five"),
    ];
    const sections = [
      makeSection("s1", "a0", "Part A"),
      makeSection("s2", "a2", "Part B"),
    ];
    const result = buildTranscript(clips, sections);

    const sectionWordSum = result.sections.reduce(
      (sum, s) => sum + s.wordCount,
      0
    );
    // Total wordCount includes section headers and [n] markers in the raw word count
    // Section word counts only count clip text
    expect(sectionWordSum).toBe(5); // "one two three" + "four five"
    expect(result.sections[0]!.wordCount).toBe(3);
    expect(result.sections[1]!.wordCount).toBe(2);
  });

  it("handles section at end with no following clips", () => {
    const clips = [makeClip("a0", "Some text")];
    const sections = [makeSection("s1", "a1", "Empty Section")];
    const result = buildTranscript(clips, sections);

    expect(result.transcript).toBe("[1] Some text\n\n## Empty Section");
    expect(result.sections).toEqual([
      { id: "s1", name: "Empty Section", order: "a1", wordCount: 0 },
    ]);
  });

  it("handles clips before the first section correctly", () => {
    const clips = [
      makeClip("a0", "Before section one"),
      makeClip("a1", "Also before section"),
      makeClip("a3", "After section"),
      makeClip("a4", "Also after section"),
    ];
    const sections = [makeSection("s1", "a2", "First Section")];
    const result = buildTranscript(clips, sections);

    expect(result.transcript).toBe(
      "[1] Before section one [2] Also before section\n\n## First Section\n\n[3] After section [4] Also after section"
    );
    expect(result.indexedClips).toHaveLength(4);
    // "After section" (2) + "Also after section" (3) = 5
    expect(result.sections).toEqual([
      { id: "s1", name: "First Section", order: "a2", wordCount: 5 },
    ]);
  });

  it("handles clips before the first section with multiple sections", () => {
    const clips = [
      makeClip("a0", "Preamble text"),
      makeClip("a2", "In first section"),
      makeClip("a4", "In second section"),
    ];
    const sections = [
      makeSection("s1", "a1", "Section One"),
      makeSection("s2", "a3", "Section Two"),
    ];
    const result = buildTranscript(clips, sections);

    expect(result.transcript).toBe(
      "[1] Preamble text\n\n## Section One\n\n[2] In first section\n\n## Section Two\n\n[3] In second section"
    );
    expect(result.sections).toEqual([
      { id: "s1", name: "Section One", order: "a1", wordCount: 3 },
      { id: "s2", name: "Section Two", order: "a3", wordCount: 3 },
    ]);
  });

  it("handles null text clips before the first section", () => {
    const clips = [
      makeClip("a0", null),
      makeClip("a1", "Before section"),
      makeClip("a3", "After section"),
    ];
    const sections = [makeSection("s1", "a2", "My Section")];
    const result = buildTranscript(clips, sections);

    expect(result.transcript).toBe(
      "[2] Before section\n\n## My Section\n\n[3] After section"
    );
    expect(result.indexedClips).toHaveLength(3);
    expect(result.indexedClips[0]!.index).toBe(1);
    expect(result.indexedClips[0]!.text).toBeNull();
  });

  it("toTranscriptItems interleaves clips and sections in timeline order", () => {
    const items = toTranscriptItems(
      [
        { order: "a1", text: "First" },
        { order: "a3", text: "Second" },
      ],
      [
        { order: "a0", name: "Intro" },
        { order: "a2", name: "Main" },
      ]
    );

    expect(items).toEqual([
      { type: "section", name: "Intro" },
      { type: "clip", text: "First" },
      { type: "section", name: "Main" },
      { type: "clip", text: "Second" },
    ]);
  });

  it("toTranscriptItems preserves trailing empty sections", () => {
    const items = toTranscriptItems(
      [{ order: "a0", text: "Body" }],
      [{ order: "a1", name: "Trailing" }]
    );

    expect(items).toEqual([
      { type: "clip", text: "Body" },
      { type: "section", name: "Trailing" },
    ]);
  });

  it("toTranscriptItems skips clips with null or empty text", () => {
    const items = toTranscriptItems(
      [
        { order: "a0", text: null },
        { order: "a1", text: "" },
        { order: "a2", text: "Kept" },
      ],
      []
    );

    expect(items).toEqual([{ type: "clip", text: "Kept" }]);
  });

  it("formatProseTranscript renders sections as ## headers between paragraphs", () => {
    const items = toTranscriptItems(
      [
        { order: "a1", text: "First clip" },
        { order: "a3", text: "Second clip" },
      ],
      [{ order: "a2", name: "Main" }]
    );

    expect(formatProseTranscript(items)).toBe(
      "First clip\n\n## Main\n\nSecond clip"
    );
  });

  it("toDiffArray renders sections as ## name strings", () => {
    const items = toTranscriptItems(
      [{ order: "a1", text: "Hello" }],
      [{ order: "a0", name: "Intro" }]
    );

    expect(toDiffArray(items)).toEqual(["## Intro", "Hello"]);
  });

  it("preserves clip metadata in indexedClips", () => {
    const clips = [
      makeClip("a0", "Test", {
        sourceStartTime: 10.5,
        sourceEndTime: 20.3,
        videoFilename: "recording.webm",
      }),
    ];
    const result = buildTranscript(clips, []);

    expect(result.indexedClips[0]).toEqual({
      index: 1,
      sourceStartTime: 10.5,
      sourceEndTime: 20.3,
      videoFilename: "recording.webm",
      text: "Test",
    });
  });
});
