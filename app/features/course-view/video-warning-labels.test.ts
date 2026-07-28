import { describe, expect, it } from "vitest";
import {
  videoActionWarningLabel,
  videoWarningLabel,
} from "./video-warning-labels";

describe("videoWarningLabel", () => {
  it("joins every warning's label", () => {
    expect(
      videoWarningLabel([
        { kind: "missingBody" },
        { kind: "missingDescription" },
      ])
    ).toBe("Missing lesson body · Missing SEO description");
  });
});

describe("videoActionWarningLabel", () => {
  it("returns null when the video has no warnings", () => {
    expect(videoActionWarningLabel([], "generate-chapters")).toBeNull();
    expect(videoActionWarningLabel([], "generate-seo-description")).toBeNull();
    expect(videoActionWarningLabel([], "edit-lesson-body")).toBeNull();
  });

  it("flags Generate Chapters when the video has no opening chapter", () => {
    expect(
      videoActionWarningLabel(
        [{ kind: "missingOpeningChapter" }],
        "generate-chapters"
      )
    ).toBe("Missing opening section");
  });

  it("flags Generate SEO Description when the description is missing", () => {
    expect(
      videoActionWarningLabel(
        [{ kind: "missingDescription" }],
        "generate-seo-description"
      )
    ).toBe("Missing SEO description");
  });

  it("flags Edit Lesson Body when the body is missing", () => {
    expect(
      videoActionWarningLabel([{ kind: "missingBody" }], "edit-lesson-body")
    ).toBe("Missing lesson body");
  });

  it("only flags the action that resolves the warning", () => {
    const warnings = [{ kind: "missingDescription" } as const];
    expect(videoActionWarningLabel(warnings, "generate-chapters")).toBeNull();
    expect(videoActionWarningLabel(warnings, "edit-lesson-body")).toBeNull();
  });
});
