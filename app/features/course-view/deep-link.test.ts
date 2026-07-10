import { describe, expect, it } from "vitest";
import { buildDeepLink } from "./deep-link";

describe("buildDeepLink", () => {
  const courseId = "course-abc";
  const sectionId = "section-def";
  const lessonId = "lesson-ghi";
  const videoId = "video-jkl";
  const beatId = "beat-mno";

  it("builds a section deep link", () => {
    expect(buildDeepLink({ courseId, sectionId })).toBe(
      "course:course-abc/section:section-def"
    );
  });

  it("builds a lesson deep link", () => {
    expect(buildDeepLink({ courseId, sectionId, lessonId })).toBe(
      "course:course-abc/section:section-def/lesson:lesson-ghi"
    );
  });

  it("builds a video deep link", () => {
    expect(buildDeepLink({ courseId, sectionId, videoId })).toBe(
      "course:course-abc/section:section-def/video:video-jkl"
    );
  });

  it("builds a beat deep link", () => {
    expect(buildDeepLink({ courseId, sectionId, videoId, beatId })).toBe(
      "course:course-abc/section:section-def/video:video-jkl/beat:beat-mno"
    );
  });
});
