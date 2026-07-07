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

  it("combines missingOpeningChapter with missing body/description", () => {
    expect(
      computeVideoWarnings({
        clips: [{ order: "a1", archived: false }],
        chapters: [],
        lessonId: "lesson-1",
        body: null,
        description: null,
      })
    ).toEqual([
      { kind: "missingOpeningChapter" },
      { kind: "missingBody" },
      { kind: "missingDescription" },
    ]);
  });
});
