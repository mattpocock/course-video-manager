import { describe, it, expect } from "vitest";
import { normalizePath } from "./vfs-path";

const ANCHOR = "/courses/my-course";

describe("normalizePath", () => {
  describe("bare / relative paths resolve against anchor", () => {
    it("resolves bare path to anchor", () => {
      expect(normalizePath("", ANCHOR)).toBe("/courses/my-course");
    });

    it("resolves '.' to anchor", () => {
      expect(normalizePath(".", ANCHOR)).toBe("/courses/my-course");
    });

    it("resolves bare child path relative to anchor", () => {
      expect(normalizePath("sections", ANCHOR)).toBe(
        "/courses/my-course/sections"
      );
    });

    it("resolves deeper bare path relative to anchor", () => {
      expect(normalizePath("sections/intro/lessons", ANCHOR)).toBe(
        "/courses/my-course/sections/intro/lessons"
      );
    });

    it("resolves ./child relative to anchor", () => {
      expect(normalizePath("./sections", ANCHOR)).toBe(
        "/courses/my-course/sections"
      );
    });
  });

  describe("absolute paths pass through", () => {
    it("keeps absolute /courses path", () => {
      expect(normalizePath("/courses/other-course", ANCHOR)).toBe(
        "/courses/other-course"
      );
    });

    it("keeps catalogue root /", () => {
      expect(normalizePath("/", ANCHOR)).toBe("/");
    });

    it("keeps /courses", () => {
      expect(normalizePath("/courses", ANCHOR)).toBe("/courses");
    });
  });

  describe(".. resolves to /courses (parent of anchor)", () => {
    it("resolves bare '..' to /courses", () => {
      expect(normalizePath("..", ANCHOR)).toBe("/courses");
    });

    it("resolves '../other-course' to /courses/other-course", () => {
      expect(normalizePath("../other-course", ANCHOR)).toBe(
        "/courses/other-course"
      );
    });

    it("resolves '../other/sections' to sibling course subtree", () => {
      expect(normalizePath("../other/sections", ANCHOR)).toBe(
        "/courses/other/sections"
      );
    });
  });

  describe("normalizes redundant segments", () => {
    it("collapses double slashes", () => {
      expect(normalizePath("/courses//my-course", ANCHOR)).toBe(
        "/courses/my-course"
      );
    });

    it("strips trailing slash", () => {
      expect(normalizePath("/courses/my-course/", ANCHOR)).toBe(
        "/courses/my-course"
      );
    });

    it("resolves mid-path ..", () => {
      expect(
        normalizePath("/courses/my-course/sections/../sections", ANCHOR)
      ).toBe("/courses/my-course/sections");
    });

    it("resolves mid-path .", () => {
      expect(normalizePath("/courses/my-course/./sections", ANCHOR)).toBe(
        "/courses/my-course/sections"
      );
    });
  });

  describe("clamps .. at catalogue root", () => {
    it("does not escape above /", () => {
      expect(normalizePath("../../..", ANCHOR)).toBe("/");
    });

    it("resolves many .. segments to /", () => {
      expect(normalizePath("../../../..", ANCHOR)).toBe("/");
    });
  });

  describe("edge cases", () => {
    it("handles course.json leaf", () => {
      expect(normalizePath("course.json", ANCHOR)).toBe(
        "/courses/my-course/course.json"
      );
    });

    it("handles deeply nested leaf path", () => {
      expect(
        normalizePath(
          "sections/intro/lessons/hello/videos/take-1/timeline.json",
          ANCHOR
        )
      ).toBe(
        "/courses/my-course/sections/intro/lessons/hello/videos/take-1/timeline.json"
      );
    });
  });
});
