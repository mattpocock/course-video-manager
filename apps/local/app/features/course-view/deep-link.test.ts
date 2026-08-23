import { describe, expect, it } from "vitest";
import { buildDeepLink, videoDeepLinkTarget } from "./deep-link";

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

describe("videoDeepLinkTarget", () => {
  it("addresses a lesson-bound video through its course and section", () => {
    const target = videoDeepLinkTarget({
      courseId: "course-abc",
      sectionId: "section-def",
      videoId: "video-jkl",
    });

    expect(target).toEqual({
      courseId: "course-abc",
      sectionId: "section-def",
      videoId: "video-jkl",
    });
    expect(buildDeepLink(target!)).toBe(
      "course:course-abc/section:section-def/video:video-jkl"
    );
  });

  it("is null for a standalone video, which sits under no section", () => {
    expect(
      videoDeepLinkTarget({
        courseId: undefined,
        sectionId: undefined,
        videoId: "video-jkl",
      })
    ).toBeNull();
  });
});
