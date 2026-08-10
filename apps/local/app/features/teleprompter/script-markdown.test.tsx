import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { links } from "./glass-links-test-helpers";
import { ScriptMarkdown } from "./script-markdown";
import { TYPE } from "./teleprompter-settings";

const render = (markdown: string) =>
  renderToStaticMarkup(<ScriptMarkdown cues>{markdown}</ScriptMarkdown>);

/** The text of every span the renderer marked as a cue, in document order. */
const cues = (html: string) =>
  [...html.matchAll(/<span[^>]*data-cue="true"[^>]*>([\s\S]*?)<\/span>/g)].map(
    (m) => m[1]
  );

describe("ScriptMarkdown cues", () => {
  it("marks a bracketed aside as a cue", () => {
    expect(cues(render("Open the file [scroll to line 40] and look."))).toEqual(
      ["[scroll to line 40]"]
    );
  });

  it("leaves the surrounding prose untouched", () => {
    const html = render("Open the file [scroll down] and look.");
    expect(html).toContain("Open the file ");
    expect(html).toContain(" and look.");
  });

  it("does not treat a link as a cue", () => {
    const html = render("Read [the docs](https://example.com) first.");
    expect(cues(html)).toEqual([]);
    expect(html).toContain("the docs");
  });

  it("does not treat a reference-style link as a cue", () => {
    const html = render(
      "Read [the docs][1] first.\n\n[1]: https://example.com"
    );
    expect(cues(html)).toEqual([]);
    expect(html).toContain("the docs");
  });

  it("does not treat an image as a cue", () => {
    expect(cues(render("![the diagram](/diagram.png)"))).toEqual([]);
  });

  it("does not treat an image whose URL never resolved as a cue", () => {
    expect(cues(render("![the diagram]"))).toEqual([]);
  });

  it("does not treat inline code as a cue", () => {
    expect(cues(render("Type `arr[0]` here, and `[this]` too."))).toEqual([]);
  });

  it("finds a cue nested inside emphasis", () => {
    expect(cues(render("**Really [lean in] now**"))).toEqual(["[lean in]"]);
  });

  it("finds a cue inside a list item", () => {
    expect(cues(render("- first [beat]\n- second"))).toEqual(["[beat]"]);
  });

  it("marks a whole bracketed line as a cue", () => {
    expect(cues(render("[improvise the playthrough here]"))).toEqual([
      "[improvise the playthrough here]",
    ]);
  });

  it("does not treat a task list's checkbox as a cue", () => {
    expect(cues(render("- [ ] first\n- [x] second"))).toEqual([]);
  });

  it("finds every cue on a line", () => {
    expect(cues(render("[pause] then [point] then go"))).toEqual([
      "[pause]",
      "[point]",
    ]);
  });

  it("keeps a cue that spans a line break in one piece", () => {
    expect(cues(render("[improvise here,\nthen recap]"))).toEqual([
      "[improvise here,\nthen recap]",
    ]);
  });

  it("keeps a direction containing nested brackets in one piece", () => {
    expect(cues(render("Now [point at [this] thing] slowly"))).toEqual([
      "[point at [this] thing]",
    ]);
  });

  it("does not treat an unclosed bracket as a cue", () => {
    const html = render("Open the file [scroll down and look.");
    expect(cues(html)).toEqual([]);
    expect(html).toContain("[scroll down and look.");
  });

  it("does not treat empty brackets as a cue", () => {
    expect(cues(render("Nothing [] to do here."))).toEqual([]);
  });

  // A cue inside a heading sits in text the crawl already set smaller than the
  // body, so an absolute size would render the aside *larger* than the line.
  it("sizes a cue relative to the line it interrupts", () => {
    expect(render("Say this [pause] now")).toMatch(
      /<span[^>]*font-size:\s*[\d.]+em/
    );
  });
});

describe("ScriptMarkdown links", () => {
  it("linkifies a URL nobody wrote as a link", () => {
    const hrefs = links(render("Go to https://example.com now.")).map(
      (l) => l.href
    );
    expect(hrefs).toEqual(["https://example.com"]);
  });

  it("linkifies a www address with no protocol", () => {
    const [link] = links(render("Visit www.example.com today."));
    expect(link?.href).toMatch(/^https?:\/\/www\.example\.com$/);
  });

  it("linkifies an email address", () => {
    expect(links(render("Mail me@example.com.")).map((l) => l.href)).toEqual([
      "mailto:me@example.com",
    ]);
  });

  it("opens a link away from the glass", () => {
    const [link] = links(render("Go to https://example.com now."));
    expect(link?.attrs).toContain('target="_blank"');
    expect(link?.attrs).toContain("noreferrer");
  });

  it("keeps the prose around a link", () => {
    const html = render("Go to https://example.com now.");
    expect(html).toContain("Go to ");
    expect(html).toContain(" now.");
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

  it("shortens a URL too long to fit the measure", () => {
    const url = "https://example.com/a/really/long/path/that/goes/on?q=1";
    const [link] = links(render(`Go to ${url} now.`));
    expect(link?.href).toBe(url);
    expect(link?.text.startsWith("example.com/")).toBe(true);
    expect(link?.text.endsWith("…")).toBe(true);
    expect(link?.text.length).toBeLessThanOrEqual(TYPE.measure);
  });

  // A written label is prose: the author chose those words to be read aloud.
  it("leaves a written label at full length", () => {
    const label = "the page where every one of the options is written down";
    const [link] = links(render(`Read [${label}](https://example.com) first.`));
    expect(link?.text).toBe(label);
  });
});

// A block that is entirely one bracketed cue is already grey and small — the
// direction inside it is the whole block, so there is no aside to mark.
describe("ScriptMarkdown with cues off", () => {
  const plain = (markdown: string) =>
    renderToStaticMarkup(
      <ScriptMarkdown cues={false}>{markdown}</ScriptMarkdown>
    );

  it("leaves brackets as plain text", () => {
    const html = plain("point at [this] thing");
    expect(cues(html)).toEqual([]);
    expect(html).toContain("[this]");
  });

  it("still linkifies a URL", () => {
    expect(links(plain("open https://example.com"))[0]?.href).toBe(
      "https://example.com"
    );
  });
});
