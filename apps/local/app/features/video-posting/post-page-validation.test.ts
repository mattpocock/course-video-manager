import { describe, it, expect } from "vitest";
import { validateYoutubeTitle } from "./post-page-validation";

describe("validateYoutubeTitle", () => {
  it("returns null for a single-line title", () => {
    expect(validateYoutubeTitle("My Great Video Title")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(validateYoutubeTitle("")).toBeNull();
  });

  it("returns null for a single line with trailing newline", () => {
    expect(validateYoutubeTitle("Title here\n")).toBeNull();
  });

  it("returns null for a single line surrounded by blank lines", () => {
    expect(validateYoutubeTitle("\n  Title here  \n\n")).toBeNull();
  });

  it("returns error for two non-empty lines", () => {
    expect(validateYoutubeTitle("Candidate 1\nCandidate 2")).toBe(
      "YouTube title must be a single line"
    );
  });

  it("returns error for multiple candidate lines separated by blank lines", () => {
    expect(
      validateYoutubeTitle("Candidate 1\n\nCandidate 2\n\nCandidate 3")
    ).toBe("YouTube title must be a single line");
  });

  it("returns null for a single non-empty line among blank lines", () => {
    expect(validateYoutubeTitle("\n\nOnly one real line\n\n")).toBeNull();
  });

  it("returns error for two lines separated by \\r\\n", () => {
    expect(validateYoutubeTitle("Candidate 1\r\nCandidate 2")).toBe(
      "YouTube title must be a single line"
    );
  });

  it("returns null for a single line with trailing \\r\\n", () => {
    expect(validateYoutubeTitle("Title here\r\n")).toBeNull();
  });
});
