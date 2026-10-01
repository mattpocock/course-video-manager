import { describe, it, expect } from "vitest";
import { formatClipMockupCommentsContext } from "./format-clip-mockup-comments-context";

describe("formatClipMockupCommentsContext", () => {
  it("returns empty string when there are no lines", () => {
    expect(formatClipMockupCommentsContext([])).toBe("");
  });

  it("skips a line with no comments", () => {
    expect(
      formatClipMockupCommentsContext([
        {
          type: "clip-mockup",
          id: "m1",
          line: "Hi.",
          comments: [],
          position: 1,
        },
      ])
    ).toBe("");
  });

  it("files each comment under its clip line or chapter, in the order given", () => {
    const result = formatClipMockupCommentsContext([
      {
        type: "chapter",
        id: "c1",
        name: "Setup",
        comments: ["Name the repo here."],
      },
      {
        type: "clip-mockup",
        id: "m3",
        line: "Here's the problem.",
        comments: ["Stress this in the article.", "Say it slower."],
        position: 3,
      },
    ]);
    expect(result).toBe(
      [
        "Chapter: Setup",
        "  - Name the repo here.",
        'Clip 3: "Here\'s the problem."',
        "  - Stress this in the article.",
        "  - Say it slower.",
      ].join("\n")
    );
  });

  it("indents the later lines of a multi-line comment", () => {
    const result = formatClipMockupCommentsContext([
      {
        type: "clip-mockup",
        id: "m1",
        line: "Hi.",
        comments: ["Line one\nLine two"],
        position: 1,
      },
    ]);
    expect(result).toBe('Clip 1: "Hi."\n  - Line one\n    Line two');
  });
});
