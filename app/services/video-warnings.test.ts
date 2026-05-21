import { describe, it, expect } from "vitest";
import { computeVideoWarnings } from "./video-warnings";

describe("computeVideoWarnings", () => {
  it("returns no warnings for a video with zero clips", () => {
    expect(computeVideoWarnings({ clips: [], chapters: [] })).toEqual([]);
  });

  it("returns no warnings when a clip section sits before the first clip", () => {
    expect(
      computeVideoWarnings({
        clips: [{ order: "a1", archived: false }],
        chapters: [{ order: "a0", archived: false }],
      })
    ).toEqual([]);
  });

  it("raises missingOpeningSection when the video has clips but no sections", () => {
    expect(
      computeVideoWarnings({
        clips: [{ order: "a1", archived: false }],
        chapters: [],
      })
    ).toEqual([{ kind: "missingOpeningSection" }]);
  });

  it("raises missingOpeningSection when the first section comes after the first clip", () => {
    expect(
      computeVideoWarnings({
        clips: [
          { order: "a1", archived: false },
          { order: "a3", archived: false },
        ],
        chapters: [{ order: "a2", archived: false }],
      })
    ).toEqual([{ kind: "missingOpeningSection" }]);
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

  it("ignores archived clip sections", () => {
    expect(
      computeVideoWarnings({
        clips: [{ order: "a2", archived: false }],
        chapters: [{ order: "a1", archived: true }],
      })
    ).toEqual([{ kind: "missingOpeningSection" }]);
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
