import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseScriptBlocks } from "./script-blocks";
import { TeleprompterCrawl } from "./teleprompter-crawl";

/** Static markup: what the glass shows before anything scrolls. */
const render = (script: string) =>
  renderToStaticMarkup(
    <TeleprompterCrawl blocks={parseScriptBlocks(script)} />
  );

describe("TeleprompterCrawl", () => {
  // The likeliest place a URL appears in a Script: you don't read one aloud,
  // you open it mid-take.
  it("linkifies a URL inside a cue block", () => {
    const html = render("[open https://example.com and walk through it]");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
  });

  // Instructions are notes to the teacher, not lines: each note and each
  // command keeps a line of its own, across the full width of the glass.
  it("renders an instructions region as a full-width panel of separate blocks", () => {
    const html = render(
      "<instructions>\n\n**Repo:** `cohort`\n\n**Reset:** `seed`\n\n```bash\nnpm run dev\n```\n\n</instructions>\n\nSay this."
    );
    expect(html).toContain("data-instructions");
    expect(html).toMatch(/width:\s*92vw/);
    expect(html).toMatch(/Repo:<\/strong>.*<\/div><div[^>]*>.*Reset:/s);
    expect(html).not.toContain("&lt;instructions&gt;");
  });

  it("renders a fenced block with a copy button", () => {
    const html = render("Run it:\n\n```bash\nls GLOSSARY.md\n```");
    expect(html).toContain("data-code-block");
    expect(html).toContain("ls GLOSSARY.md");
    expect(html).toContain('aria-label="Copy to clipboard"');
  });

  // A cue or a command between two steps splits the list in two; the second
  // half carries on the count rather than starting again at 1.
  it("keeps a numbered list's count after a break", () => {
    expect(render("1. One\n\n[cue]\n\n5. Five")).toContain('start="5"');
  });
});
