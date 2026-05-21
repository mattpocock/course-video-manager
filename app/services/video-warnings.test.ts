import { describe, it, expect } from "vitest";
import { computeVideoWarnings } from "./video-warnings";

describe("computeVideoWarnings", () => {
  it("returns no warnings for a video with zero clips", () => {
    expect(computeVideoWarnings({ clips: [], chapters: [] })).toEqual([]);
  });

  it("returns no warnings when a chapter sits before the first clip", () => {
    expect(
      computeVideoWarnings({
        clips: [{ order: "a1", archived: false }],
        chapters: [{ order: "a0", archived: false }],
      })
    ).toEqual([]);
  });

  it("raises missingOpeningChapter when the video has clips but no sections", () => {
    expect(
      computeVideoWarnings({
        clips: [{ order: "a1", archived: false }],
        chapters: [],
      })
    ).toEqual([{ kind: "missingOpeningChapter" }]);
  });

  it("raises missingOpeningChapter when the first section comes after the first clip", () => {
    expect(
      computeVideoWarnings({
        clips: [
          { order: "a1", archived: false },
          { order: "a3", archived: false },
        ],
        chapters: [{ order: "a2", archived: false }],
      })
    ).toEqual([{ kind: "missingOpeningChapter" }]);
  });

  it("ignores archived clips when locating the first clip", () => {
    expect(
      computeVideoWarnings({
        clips: [
          { order: "a1", archived: true },
          { order: "a3", archived: false },
        ],
        chapters: [{ order: "a2", archived: false }],
      })
    ).toEqual([]);
  });

  it("ignores archived chapters", () => {
    expect(
      computeVideoWarnings({
        clips: [{ order: "a2", archived: false }],
        chapters: [{ order: "a1", archived: true }],
      })
    ).toEqual([{ kind: "missingOpeningChapter" }]);
  });

  it("returns no warnings when only archived clips remain", () => {
    expect(
      computeVideoWarnings({
        clips: [{ order: "a1", archived: true }],
        chapters: [],
      })
    ).toEqual([]);
  });
});
