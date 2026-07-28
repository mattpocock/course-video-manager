import { describe, it, expect } from "vitest";
import { getScriptSection } from "./script-instructions";

describe("getScriptSection", () => {
  it("returns empty string for empty script", () => {
    expect(getScriptSection("")).toBe("");
  });

  it("returns empty string for a whitespace-only script", () => {
    expect(getScriptSection("   \n  ")).toBe("");
  });

  it("wraps the script in <script> tags", () => {
    const result = getScriptSection("[On screen: the repo]");
    expect(result).toContain("<script>");
    expect(result).toContain("[On screen: the repo]");
    expect(result).toContain("</script>");
  });

  it("frames the script as the base the presenter improvised from", () => {
    const result = getScriptSection("some script");
    expect(result).toContain("improvised from");
  });

  it("restricts the script's authority to spelling and naming", () => {
    const result = getScriptSection("some script");
    expect(result).toContain("spelling and naming");
  });

  it("tells the model to drop script content absent from the transcript", () => {
    const result = getScriptSection("some script");
    expect(result).toContain("absent from the transcript");
  });

  it("ends with a trailing newline for composability with other sections", () => {
    const result = getScriptSection("some script");
    expect(result.endsWith("\n")).toBe(true);
  });
});
