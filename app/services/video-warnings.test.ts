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

  it("raises missingChapters when the video has clips but no chapters", () => {
    expect(
      computeVideoWarnings({
        clips: [{ order: "a1", archived: false }],
        chapters: [],
      })
    ).toEqual([{ kind: "missingChapters" }]);
  });

  it("raises missingChapters when the first chapter comes after the first clip", () => {
    expect(
      computeVideoWarnings({
        clips: [
          { order: "a1", archived: false },
          { order: "a3", archived: false },
        ],
        chapters: [{ order: "a2", archived: false }],
      })
    ).toEqual([{ kind: "missingChapters" }]);
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
    ).toEqual([{ kind: "missingChapters" }]);
  });

  it("raises missingChapters when a chapter shares the first clip's order", () => {
    // "Opens with a chapter" means strictly before the first clip, so a chapter
    // tied with it does not open the video.
    expect(
      computeVideoWarnings({
        clips: [{ order: "a1", archived: false }],
        chapters: [{ order: "a1", archived: false }],
      })
    ).toEqual([{ kind: "missingChapters" }]);
  });

  it("finds the earliest clip and chapter regardless of array order", () => {
    expect(
      computeVideoWarnings({
        clips: [
          { order: "a5", archived: false },
          { order: "a2", archived: false },
        ],
        chapters: [
          { order: "a4", archived: false },
          { order: "a1", archived: false },
        ],
      })
    ).toEqual([]);
  });

  it("ignores archived entries when they sort earliest", () => {
    // Both the archived clip and the archived chapter sort ahead of everything
    // live, so neither may influence the comparison.
    expect(
      computeVideoWarnings({
        clips: [
          { order: "a0", archived: true },
          { order: "a2", archived: false },
        ],
        chapters: [
          { order: "a1", archived: true },
          { order: "a3", archived: false },
        ],
      })
    ).toEqual([{ kind: "missingChapters" }]);
  });

  it("returns no warnings when only archived clips remain", () => {
    expect(
      computeVideoWarnings({
        clips: [{ order: "a1", archived: true }],
        chapters: [],
      })
    ).toEqual([]);
  });

  it("does not require body/description for a non-lesson video", () => {
    expect(
      computeVideoWarnings({
        clips: [],
        chapters: [],
        body: null,
        description: null,
      })
    ).toEqual([]);
  });

  it("flags a lesson video missing both body and description", () => {
    expect(
      computeVideoWarnings({
        clips: [],
        chapters: [],
        lessonId: "lesson-1",
        body: null,
        description: "",
      })
    ).toEqual([{ kind: "missingBody" }, { kind: "missingDescription" }]);
  });

  it("flags only the missing body when the description is present", () => {
    expect(
      computeVideoWarnings({
        clips: [],
        chapters: [],
        lessonId: "lesson-1",
        body: "   ",
        description: "A solid SEO description.",
      })
    ).toEqual([{ kind: "missingBody" }]);
  });

  it("returns no body/description warnings when both are present", () => {
    expect(
      computeVideoWarnings({
        clips: [],
        chapters: [],
        lessonId: "lesson-1",
        body: "The body.",
        description: "The description.",
      })
    ).toEqual([]);
  });

  it("combines missingChapters with missing body/description", () => {
    expect(
      computeVideoWarnings({
        clips: [{ order: "a1", archived: false }],
        chapters: [],
        lessonId: "lesson-1",
        body: null,
        description: null,
      })
    ).toEqual([
      { kind: "missingChapters" },
      { kind: "missingBody" },
      { kind: "missingDescription" },
    ]);
  });
});
