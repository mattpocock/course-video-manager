import { describe, it, expect } from "vitest";
import { buildSectionRenameEvent } from "./section-title-editor";

describe("buildSectionRenameEvent", () => {
  it("1. stores the title verbatim and returns event when title changes", () => {
    const result = buildSectionRenameEvent({
      value: "new section title",
      sectionTitle: "Old Title",
      sectionId: "abc",
    });
    expect(result).toEqual({
      type: "update-section-name",
      sectionId: "abc",
      title: "new section title",
    });
  });

  it("2. returns null when trimmed value equals current title (no-op)", () => {
    const result = buildSectionRenameEvent({
      value: "  Before We Start  ",
      sectionTitle: "Before We Start",
      sectionId: "abc",
    });
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

  it("4. preserves the user's exact casing and returns event when title differs", () => {
    const result = buildSectionRenameEvent({
      value: "gRPC in Practice",
      sectionTitle: "Old Title",
      sectionId: "section-1",
    });
    expect(result).toEqual({
      type: "update-section-name",
      sectionId: "section-1",
      title: "gRPC in Practice",
    });
  });
});
