import { describe, it, expect } from "vitest";
import { buildMoveToCourseRedirectUrl } from "./move-to-course-redirect";

describe("buildMoveToCourseRedirectUrl", () => {
  it("should include courseId query param and lesson anchor fragment", () => {
    const url = buildMoveToCourseRedirectUrl({
      courseId: "course-123",
      lessonId: "lesson-456",
    });
    expect(url).toBe("/courses/course-123#lesson-456");
  });

  it("should produce correct URL with UUID-style IDs", () => {
    const url = buildMoveToCourseRedirectUrl({
      courseId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      lessonId: "f0e1d2c3-b4a5-6789-0123-456789abcdef",
    });
    expect(url).toBe(
      "/courses/a1b2c3d4-e5f6-7890-abcd-ef1234567890#f0e1d2c3-b4a5-6789-0123-456789abcdef"
    );
  });
});
