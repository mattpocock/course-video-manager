import { describe, it, expect } from "vitest";
import { getClipMockupCommentsSection } from "./clip-mockup-comments-instructions";

describe("getClipMockupCommentsSection", () => {
  it("returns empty string for no comments", () => {
    expect(getClipMockupCommentsSection("")).toBe("");
    expect(getClipMockupCommentsSection("  \n ")).toBe("");
  });

  it("wraps the comments in <comments> tags under an Author's Comments heading", () => {
    const result = getClipMockupCommentsSection(
      'Clip 1: "Hi."\n  - Stress this.'
    );
    expect(result).toContain("## Author's Comments");
    expect(result).toContain("<comments>");
    expect(result).toContain("  - Stress this.");
    expect(result).toContain("</comments>");
  });

  it("tells the model to follow a comment about the output, and never quote one", () => {
    const result = getClipMockupCommentsSection("some comments");
    expect(result).toContain("instruction to follow");
    expect(result).toContain(
      "no comment is ever quoted as words said on camera"
    );
  });
});
