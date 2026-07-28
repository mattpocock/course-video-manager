import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScriptMarkdown } from "./script-markdown";

const render = (markdown: string) =>
  renderToStaticMarkup(<ScriptMarkdown>{markdown}</ScriptMarkdown>);

/** The text of every span the renderer marked as a cue, in document order. */
const cues = (html: string) =>
  [...html.matchAll(/<span[^>]*data-cue="true"[^>]*>(.*?)<\/span>/g)].map(
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

  it("does not treat an image as a cue", () => {
    expect(cues(render("![the diagram](/diagram.png)"))).toEqual([]);
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
});
