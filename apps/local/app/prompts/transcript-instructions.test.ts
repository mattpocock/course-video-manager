import { describe, it, expect } from "vitest";
import { getTranscriptSection } from "./transcript-instructions";

describe("getTranscriptSection", () => {
  it("returns empty string for empty transcript", () => {
    expect(getTranscriptSection("")).toBe("");
  });

  it("wraps transcript in <transcript> tags", () => {
    const result = getTranscriptSection("[1] Hello world");
    expect(result).toContain("<transcript>");
    expect(result).toContain("[1] Hello world");
    expect(result).toContain("</transcript>");
  });

  it("includes on-screen annotation explanation", () => {
    const result = getTranscriptSection("[1] Hello world");
    expect(result).toContain("«on screen:");
    expect(result).toContain(
      "This means those web pages were visible on screen"
    );
  });

  it("ends with a trailing newline for composability with other sections", () => {
    const result = getTranscriptSection("[1] Hello world");
    expect(result.endsWith("\n")).toBe(true);
  });

  it("uses custom preamble when provided", () => {
    const result = getTranscriptSection(
      "[1] Hello",
      "Here is the transcript of the video (if available):"
    );
    expect(result).toContain(
      "Here is the transcript of the video (if available):"
    );
    expect(result).toContain("«on screen:");
  });
});
