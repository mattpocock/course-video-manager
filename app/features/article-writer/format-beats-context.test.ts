import { describe, it, expect } from "vitest";
import { formatBeatsContext } from "./format-beats-context";

describe("formatBeatsContext", () => {
  it("returns empty string when beats array is empty", () => {
    expect(formatBeatsContext([])).toBe("");
  });

  it("formats a single beat with title and description", () => {
    const result = formatBeatsContext([
      {
        kind: "definition",
        title: "What is Effect",
        description: "Explain the core concept of Effect as a library",
      },
    ]);
    expect(result).toBe(
      "1. [Definition] What is Effect\n   Explain the core concept of Effect as a library"
    );
  });

  it("formats a beat with title but no description", () => {
    const result = formatBeatsContext([
      { kind: "walkthrough", title: "Setup", description: "" },
    ]);
    expect(result).toBe("1. [Walkthrough] Setup");
  });

  it("formats multiple beats in order", () => {
    const result = formatBeatsContext([
      {
        kind: "definition",
        title: "What is a pipe",
        description: "Define pipe and flow",
      },
      { kind: "walkthrough", title: "Using pipe", description: "" },
      {
        kind: "quest",
        title: "Try it yourself",
        description: "Challenge: refactor a callback chain using pipe",
      },
    ]);
    expect(result).toBe(
      [
        "1. [Definition] What is a pipe",
        "   Define pipe and flow",
        "2. [Walkthrough] Using pipe",
        "3. [Quest] Try it yourself",
        "   Challenge: refactor a callback chain using pipe",
      ].join("\n")
    );
  });

  it("formats a beat with no title", () => {
    const result = formatBeatsContext([
      { kind: "playthrough", title: "", description: "Build the app" },
    ]);
    expect(result).toBe("1. [Playthrough]\n   Build the app");
  });

  it("preserves multi-line descriptions with indentation", () => {
    const result = formatBeatsContext([
      {
        kind: "reaction",
        title: "Code review",
        description: "Line one\nLine two\nLine three",
      },
    ]);
    expect(result).toBe(
      "1. [Reaction] Code review\n   Line one\n   Line two\n   Line three"
    );
  });
});
