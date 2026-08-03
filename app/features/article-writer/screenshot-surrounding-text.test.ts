import { describe, expect, it } from "vitest";
import { extractSurroundingText } from "./screenshot-surrounding-text";

const doc = [
  "Para one.",
  "Para two.",
  "Para three.",
  '<ChooseScreenshot clipIndex={4} alt="the terminal" />',
  "Para five.",
  "Para six.",
  "Para seven.",
].join("\n\n");

describe("extractSurroundingText", () => {
  it("takes two paragraphs either side and drops the tag itself", () => {
    expect(extractSurroundingText(doc, 4, "the terminal")).toBe(
      "Para two.\n\nPara three.\n\nPara five.\n\nPara six."
    );
  });

  it("truncates at the start of the document", () => {
    const short = `<ChooseScreenshot clipIndex={1} alt="x" />\n\nAfter.`;
    expect(extractSurroundingText(short, 1, "x")).toBe("After.");
  });

  it("distinguishes two tags sharing a clip index by their alt", () => {
    const twoTags = [
      "Before A.",
      '<ChooseScreenshot clipIndex={2} alt="first" />',
      "Between.",
      '<ChooseScreenshot clipIndex={2} alt="second" />',
      "After B.",
    ].join("\n\n");

    expect(extractSurroundingText(twoTags, 2, "first")).toContain("Before A.");
    expect(extractSurroundingText(twoTags, 2, "first")).not.toContain(
      "After B."
    );
    expect(extractSurroundingText(twoTags, 2, "second")).toContain("After B.");
  });

  it("escapes regex metacharacters in the alt", () => {
    const tricky = `Before.\n\n<ChooseScreenshot clipIndex={1} alt="a (b) [c]" />\n\nAfter.`;
    expect(extractSurroundingText(tricky, 1, "a (b) [c]")).toBe(
      "Before.\n\nAfter."
    );
  });

  it("returns empty string when the tag is absent", () => {
    expect(extractSurroundingText(doc, 99, "nope")).toBe("");
  });
});
