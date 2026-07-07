import { describe, it, expect } from "vitest";
import { buildSectionRenameEvent } from "./section-title-editor";

describe("buildSectionRenameEvent", () => {
  it("1. capitalizes and returns event when title changes", () => {
    const result = buildSectionRenameEvent({
      value: "new section title",
      sectionTitle: "Old Title",
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
      sectionTitle: "Before We Start",
      sectionId: "abc",
    });
    // capitalizeTitle("before we start") === "Before We Start" === sectionTitle
    expect(result).toBeNull();
  });

  it("3. returns null for empty input", () => {
    const result = buildSectionRenameEvent({
      value: "   ",
      sectionTitle: "Old Title",
      sectionId: "abc",
    });
    expect(result).toBeNull();
  });

  it("4. returns event when title differs from current path", () => {
    const result = buildSectionRenameEvent({
      value: "new title",
      sectionTitle: "Old Title",
      sectionId: "section-1",
    });
    expect(result).toEqual({
      type: "update-section-name",
      sectionId: "section-1",
      title: "New Title",
    });
  });
});
