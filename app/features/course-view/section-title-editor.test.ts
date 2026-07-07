import { describe, it, expect } from "vitest";
import { buildSectionRenameEvent } from "./section-title-editor";

describe("buildSectionRenameEvent", () => {
  it("capitalizes and returns event when title changes", () => {
    const result = buildSectionRenameEvent({
      value: "new section title",
      currentTitle: "Old Title",
      sectionId: "abc",
    });
    expect(result).toEqual({
      type: "update-section-name",
      sectionId: "abc",
      title: "New Section Title",
    });
  });

  it("returns null when capitalized value equals current title (no-op)", () => {
    const result = buildSectionRenameEvent({
      value: "before we start",
      currentTitle: "Before We Start",
      sectionId: "abc",
    });
    expect(result).toBeNull();
  });

  it("returns null for empty input", () => {
    const result = buildSectionRenameEvent({
      value: "   ",
      currentTitle: "Old Title",
      sectionId: "abc",
    });
    expect(result).toBeNull();
  });

  it("returns event when title differs from current", () => {
    const result = buildSectionRenameEvent({
      value: "new title",
      currentTitle: "Old Title",
      sectionId: "section-1",
    });
    expect(result).toEqual({
      type: "update-section-name",
      sectionId: "section-1",
      title: "New Title",
    });
  });

  it("sends human title for real sections (not a slug)", () => {
    const result = buildSectionRenameEvent({
      value: "Advanced TypeScript",
      currentTitle: "Introduction",
      sectionId: "section-4",
    });
    expect(result).toEqual({
      type: "update-section-name",
      sectionId: "section-4",
      title: "Advanced TypeScript",
    });
  });
});
