import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScriptMarkdown } from "./script-markdown";

const render = (markdown: string) =>
  renderToStaticMarkup(<ScriptMarkdown>{markdown}</ScriptMarkdown>);

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
