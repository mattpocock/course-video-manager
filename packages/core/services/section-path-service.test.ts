import { describe, expect, it } from "vitest";
import { deriveSectionPath, parseSectionPath } from "./section-path-service.js";

describe("deriveSectionPath", () => {
  it("derives path from title alone, no ordering number", () => {
    expect(deriveSectionPath("Introduction")).toBe("introduction");
  });

  it("falls back to 'untitled' for empty title", () => {
    expect(deriveSectionPath("")).toBe("untitled");
  });

  it("falls back to 'untitled' for symbols-only title", () => {
    expect(deriveSectionPath("!@#$")).toBe("untitled");
  });
});

describe("parseSectionPath", () => {
  it("parses standard path", () => {
    expect(parseSectionPath("01-intro")).toEqual({
      sectionNumber: 1,
      slug: "intro",
    });
  });

  it("parses double-digit section number", () => {
    expect(parseSectionPath("12-advanced-topic")).toEqual({
      sectionNumber: 12,
      slug: "advanced-topic",
    });
  });

  it("parses multi-word slug", () => {
    expect(parseSectionPath("03-getting-started-with-ts")).toEqual({
      sectionNumber: 3,
      slug: "getting-started-with-ts",
    });
  });

  it("returns null for path without number prefix", () => {
    expect(parseSectionPath("no-number")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSectionPath("")).toBeNull();
  });

  it("returns null for number-only path (no slug)", () => {
    expect(parseSectionPath("03")).toBeNull();
  });
});
