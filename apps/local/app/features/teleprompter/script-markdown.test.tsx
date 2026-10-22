import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { links } from "./glass-links-test-helpers";
import { ScriptMarkdown } from "./script-markdown";

const render = (markdown: string) =>
  renderToStaticMarkup(<ScriptMarkdown>{markdown}</ScriptMarkdown>);

// Brackets are prose like any other: the glass sets them as written.
describe("ScriptMarkdown brackets", () => {
  it("leaves a bracketed aside as plain text", () => {
    const html = render("Open the file [scroll to line 40] and look.");
    expect(html).toContain("Open the file [scroll to line 40] and look.");
    expect(html).not.toContain("<span");
  });
});

describe("ScriptMarkdown links", () => {
  it("linkifies a URL nobody wrote as a link", () => {
    const hrefs = links(render("Go to https://example.com now.")).map(
      (l) => l.href
    );
    expect(hrefs).toEqual(["https://example.com"]);
  });

  it("still links a URL that was written as a markdown link", () => {
    const [link] = links(render("Read [the docs](https://example.com) first."));
    expect(link?.href).toBe("https://example.com");
    expect(link?.text).toBe("the docs");
  });

  // The protocol is never spoken and never read, and on a 25ch measure it is a
  // third of the line.
  it("drops the protocol from a URL that is its own label", () => {
    expect(links(render("Go to https://example.com/ now."))[0]?.text).toBe(
      "example.com"
    );
  });

  it("shows a URL longer than the measure in full", () => {
    const url = "https://example.com/a/really/long/path/that/goes/on?q=1";
    const [link] = links(render(`Go to ${url} now.`));
    expect(link?.href).toBe(url);
    expect(link?.text).toBe("example.com/a/really/long/path/that/goes/on?q=1");
  });

  // A written label is prose: the author chose those words to be read aloud.
  it("leaves a written label at full length", () => {
    const label = "the page where every one of the options is written down";
    const [link] = links(render(`Read [${label}](https://example.com) first.`));
    expect(link?.text).toBe(label);
  });
});
