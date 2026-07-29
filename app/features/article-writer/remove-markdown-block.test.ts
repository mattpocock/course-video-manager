import { describe, it, expect } from "vitest";
import { removeMarkdownBlock } from "./remove-markdown-block";

/**
 * Offsets in these tests are derived with `indexOf` so each case reads as
 * "remove this block", the same way the preview's hover control does.
 */
function rangeOf(markdown: string, block: string) {
  const start = markdown.indexOf(block);
  if (start === -1) throw new Error(`Block not found: ${block}`);
  return { start, end: start + block.length };
}

function removeBlock(markdown: string, block: string) {
  const { start, end } = rangeOf(markdown, block);
  return removeMarkdownBlock(markdown, start, end);
}

describe("removeMarkdownBlock", () => {
  it("removes a paragraph along with the blank line that followed it", () => {
    const doc = `# Title

First para.

Second para.
`;

    expect(removeBlock(doc, "First para.")).toBe(`# Title

Second para.
`);
  });

  it("removes a heading along with the blank line that followed it", () => {
    const doc = `# Title

First para.
`;

    expect(removeBlock(doc, "# Title")).toBe(`First para.
`);
  });

  it("removes the last block without leaving trailing blank lines", () => {
    const doc = `# Title

First para.

Second para.
`;

    expect(removeBlock(doc, "Second para.")).toBe(`# Title

First para.
`);
  });

  it("keeps a list tight when removing a middle list item", () => {
    const doc = `- alpha
- beta
- gamma
`;

    expect(removeBlock(doc, "- beta")).toBe(`- alpha
- gamma
`);
  });

  it("removes the first list item", () => {
    const doc = `- alpha
- beta
`;

    expect(removeBlock(doc, "- alpha")).toBe(`- beta
`);
  });

  it("removes the last list item", () => {
    const doc = `- alpha
- beta
`;

    expect(removeBlock(doc, "- beta")).toBe(`- alpha
`);
  });

  it("returns an empty document when the only block is removed", () => {
    expect(removeBlock(`Only para.\n`, "Only para.")).toBe("");
  });

  it("keeps the blank lines that preceded the removed block", () => {
    const doc = `Intro.


Middle.


Outro.
`;

    expect(removeBlock(doc, "Middle.")).toBe(`Intro.


Outro.
`);
  });

  it("leaves neighbouring blocks untouched when text repeats", () => {
    const doc = `Same.

Same.
`;

    const start = doc.lastIndexOf("Same.");
    expect(removeMarkdownBlock(doc, start, start + "Same.".length)).toBe(`Same.
`);
  });

  // A nested list item's reported range starts at its bullet, leaving the
  // indent that positions it behind — which would re-indent the item after it.
  it("takes the indent with a nested list item", () => {
    const doc = `- outer
  - inner a
  - inner b
`;

    expect(removeBlock(doc, "- inner a")).toBe(`- outer
  - inner b
`);
  });

  // A paragraph inside a blockquote starts after the "> " that opens it; the
  // marker has to go too or an empty quote is left behind.
  it("takes the quote marker with a blockquoted paragraph", () => {
    const doc = `> A quoted line.
> Second quoted line.

After.
`;

    const start = doc.indexOf("A quoted line.");
    const end =
      doc.indexOf("Second quoted line.") + "Second quoted line.".length;
    expect(removeMarkdownBlock(doc, start, end)).toBe(`After.
`);
  });

  it("keeps the rest of a multi-paragraph blockquote", () => {
    const doc = `> Para one.
>
> Para two.
`;

    expect(removeBlock(doc, "Para one.")).toBe(`>
> Para two.
`);
  });
});
