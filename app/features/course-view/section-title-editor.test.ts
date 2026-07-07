import { describe, it, expect } from "vitest";
import { buildSectionRenameEvent } from "./section-title-editor";

describe("buildSectionRenameEvent", () => {
  describe("ghost sections", () => {
    it("1. capitalizes and returns event when title changes", () => {
      const result = buildSectionRenameEvent({
        value: "new section title",
        isGhostSection: true,
        sectionPath: "Old Title",
        currentSlug: "Old Title",
        sectionId: "abc",
      });
      expect(result).toEqual({
        type: "update-section-name",
        sectionId: "abc",
        title: "New Section Title",
      });
    });

    it("2. returns null when capitalized value equals current path (no-op)", () => {
      const result = buildSectionRenameEvent({
        value: "before we start",
        isGhostSection: true,
        sectionPath: "Before We Start",
        currentSlug: "Before We Start",
        sectionId: "abc",
      });
      // capitalizeTitle("before we start") === "Before We Start" === sectionPath
      expect(result).toBeNull();
    });

    it("3. returns null for empty input", () => {
      const result = buildSectionRenameEvent({
        value: "   ",
        isGhostSection: true,
        sectionPath: "Old Title",
        currentSlug: "Old Title",
        sectionId: "abc",
      });
      expect(result).toBeNull();
    });

    it("4. returns event when title differs from current path", () => {
      const result = buildSectionRenameEvent({
        value: "new title",
        isGhostSection: true,
        sectionPath: "Old Title",
        currentSlug: "Old Title",
        sectionId: "section-1",
      });
      expect(result).toEqual({
        type: "update-section-name",
        sectionId: "section-1",
        title: "New Title",
      });
    });
  });

  describe("real (materialized) sections", () => {
    it("5. converts to slug and returns event when slug changes", () => {
      const result = buildSectionRenameEvent({
        value: "new slug name",
        isGhostSection: false,
        sectionPath: "01-old-slug",
        currentSlug: "old-slug",
        sectionId: "section-2",
      });
      expect(result).toEqual({
        type: "update-section-name",
        sectionId: "section-2",
        title: "new-slug-name",
      });
    });

    it("6. returns null when slug is unchanged (no-op)", () => {
      const result = buildSectionRenameEvent({
        value: "old-slug",
        isGhostSection: false,
        sectionPath: "01-old-slug",
        currentSlug: "old-slug",
        sectionId: "section-2",
      });
      expect(result).toBeNull();
    });

    it("7. returns null for empty slug input", () => {
      const result = buildSectionRenameEvent({
        value: "",
        isGhostSection: false,
        sectionPath: "01-intro",
        currentSlug: "intro",
        sectionId: "section-3",
      });
      expect(result).toBeNull();
    });

    it("8. slugifies input with spaces and uppercase", () => {
      const result = buildSectionRenameEvent({
        value: "Advanced TypeScript",
        isGhostSection: false,
        sectionPath: "02-intro",
        currentSlug: "intro",
        sectionId: "section-4",
      });
      expect(result).toEqual({
        type: "update-section-name",
        sectionId: "section-4",
        title: "advanced-typescript",
      });
    });
  });
});
