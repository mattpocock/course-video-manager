import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { Element } from "hast";
import type { ReactNode } from "react";
import { getRemovableRange } from "components/ui/kibo-ui/ai/removable-block";
import {
  mapPreprocessedOffsetToSource,
  preprocessChooseScreenshotMarkdown,
} from "./choose-screenshot-markdown";
import { removeMarkdownBlock } from "./remove-markdown-block";

const CUSTOM_TAGS = new Set(["choosescreenshot"]);

/**
 * Drives the same chain the document preview does — preprocess, render through
 * react-markdown, read the source position off the rendered node — and returns
 * what the X button on each block would remove.
 *
 * The offsets react-markdown reports index into the *preprocessed* markdown, so
 * this is where a mistake in `mapPreprocessedOffsetToSource` shows up as the
 * wrong text being cut out of the stored document.
 */
function removableBlocks(document: string) {
  const blocks: Array<{ tagName: string; text: string; result?: string }> = [];

  const record =
    (tagName: string) => (props: { node?: Element; children?: ReactNode }) => {
      const range = getRemovableRange(props.node, CUSTOM_TAGS);
      const rendered = preprocessChooseScreenshotMarkdown(document);
      blocks.push({
        tagName,
        text: range
          ? rendered.slice(range.start, range.end)
          : rendered.slice(
              props.node?.position?.start?.offset ?? 0,
              props.node?.position?.end?.offset ?? 0
            ),
        result: range
          ? removeMarkdownBlock(
              document,
              mapPreprocessedOffsetToSource(document, range.start),
              mapPreprocessedOffsetToSource(document, range.end)
            )
          : undefined,
      });
      // Render children so nested blocks are recorded too.
      return <div>{props.children}</div>;
    };

  renderToStaticMarkup(
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        p: record("p"),
        h1: record("h1"),
        h2: record("h2"),
        li: record("li"),
      }}
    >
      {preprocessChooseScreenshotMarkdown(document)}
    </Markdown>
  );

  return blocks;
}

describe("removing a block from the rendered document", () => {
  const document = `# Title

Intro paragraph.

<ChooseScreenshot clipIndex={1} alt="the editor" />

## Steps

- alpha
- beta

Closing paragraph.
`;

  it("offers a removal for every prose block", () => {
    expect(removableBlocks(document).map((b) => [b.tagName, b.text])).toEqual([
      ["h1", "# Title"],
      ["p", "Intro paragraph."],
      [
        "p",
        `<choosescreenshot clipindex="1" alt="the editor"></choosescreenshot>`,
      ],
      ["h2", "## Steps"],
      ["li", "- alpha"],
      ["li", "- beta"],
      ["p", "Closing paragraph."],
    ]);
  });

  it("skips the paragraph that only hosts the screenshot picker", () => {
    const screenshotBlock = removableBlocks(document).find((b) =>
      b.text.includes("choosescreenshot")
    );
    expect(screenshotBlock?.result).toBeUndefined();
  });

  it("removes a paragraph that follows a screenshot tag", () => {
    const closing = removableBlocks(document).find(
      (b) => b.text === "Closing paragraph."
    );

    expect(closing?.result).toBe(`# Title

Intro paragraph.

<ChooseScreenshot clipIndex={1} alt="the editor" />

## Steps

- alpha
- beta
`);
  });

  it("removes a heading that follows a screenshot tag", () => {
    const heading = removableBlocks(document).find(
      (b) => b.text === "## Steps"
    );

    expect(heading?.result).toBe(`# Title

Intro paragraph.

<ChooseScreenshot clipIndex={1} alt="the editor" />

- alpha
- beta

Closing paragraph.
`);
  });

  it("removes a list item without loosening the list", () => {
    const item = removableBlocks(document).find((b) => b.text === "- alpha");

    expect(item?.result).toBe(`# Title

Intro paragraph.

<ChooseScreenshot clipIndex={1} alt="the editor" />

## Steps

- beta

Closing paragraph.
`);
  });

  it("removes the leading heading", () => {
    const title = removableBlocks(document).find((b) => b.text === "# Title");

    expect(title?.result).toBe(`Intro paragraph.

<ChooseScreenshot clipIndex={1} alt="the editor" />

## Steps

- alpha
- beta

Closing paragraph.
`);
  });
});

describe("removing a block nested inside another", () => {
  it("keeps the indentation of the sibling below a nested list item", () => {
    const nested = `- outer
  - inner a
  - inner b
`;
    const item = removableBlocks(nested).find((b) => b.text === "- inner a");

    expect(item?.result).toBe(`- outer
  - inner b
`);
  });

  it("removes the whole subtree when the outer list item goes", () => {
    const nested = `- outer
  - inner a

After.
`;
    const outer = removableBlocks(nested).find((b) =>
      b.text.startsWith("- outer")
    );

    expect(outer?.result).toBe(`After.
`);
  });

  it("takes the quote marker when removing a blockquoted paragraph", () => {
    const quoted = `> A quoted line.
> Second quoted line.

After.
`;
    const paragraph = removableBlocks(quoted).find((b) =>
      b.text.startsWith("A quoted line.")
    );

    expect(paragraph?.result).toBe(`After.
`);
  });
});
