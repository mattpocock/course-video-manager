import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { links } from "./glass-links-test-helpers";
import { LinkedText } from "./linked-text";
import { TYPE } from "./teleprompter-settings";

const render = (text: string) =>
  renderToStaticMarkup(<LinkedText>{text}</LinkedText>);

describe("LinkedText", () => {
  it("links a URL inside a plain note", () => {
    const html = render("Show https://example.com/pricing here.");
    expect(links(html).map((l) => l.href)).toEqual([
      "https://example.com/pricing",
    ]);
    expect(html).toContain("Show ");
    expect(html).toContain(" here.");
  });

  it("links a www address with no protocol", () => {
    expect(links(render("Show www.example.com.")).map((l) => l.href)).toEqual([
      "https://www.example.com",
    ]);
  });

  // An href with no scheme is a path: the browser would resolve it against the
  // teleprompter and navigate the glass away instead of opening the page.
  it("gives a www address a scheme however it was capitalised", () => {
    expect(links(render("Go to WWW.example.com now."))[0]?.href).toBe(
      "https://WWW.example.com"
    );
  });

  it("opens links away from the glass", () => {
    const [link] = links(render("https://example.com"));
    expect(link?.attrs).toContain('target="_blank"');
    expect(link?.attrs).toContain("noreferrer");
  });

  it("leaves the sentence's punctuation out of the address", () => {
    const [link] = links(render("Open https://example.com/docs, then talk."));
    expect(link?.href).toBe("https://example.com/docs");
    expect(render("Open https://example.com/docs, then talk.")).toContain(
      ", then talk."
    );
  });

  it("closes a bracketed address at the bracket", () => {
    expect(links(render("[https://example.com]"))[0]?.href).toBe(
      "https://example.com"
    );
  });

  // A parenthesis the sentence put round the address, not one the address owns.
  it("leaves the parenthesis that wrapped the address out of it", () => {
    expect(links(render("(see https://example.com/docs)"))[0]?.href).toBe(
      "https://example.com/docs"
    );
  });

  // The other way round: plenty of real pages carry a balanced pair in the
  // path, and stopping at the `(` points the link at a page that isn't there.
  it("keeps a balanced pair of parentheses inside the address", () => {
    const url = "https://en.wikipedia.org/wiki/Trie_(data_structure)";
    const html = render(`Read ${url} now.`);
    expect(links(html)[0]?.href).toBe(url);
    expect(html).not.toContain("(data_structure) now.");
  });

  it("keeps the address's own parentheses when the sentence adds one too", () => {
    expect(
      links(render("(read https://example.com/Trie_(data_structure))"))[0]?.href
    ).toBe("https://example.com/Trie_(data_structure)");
  });

  it("links every address in the note", () => {
    expect(
      links(render("https://one.example.com then https://two.example.com")).map(
        (l) => l.href
      )
    ).toEqual(["https://one.example.com", "https://two.example.com"]);
  });

  it("leaves a note with no address alone", () => {
    const html = render("Nothing to click. See beats.md, then talk.");
    expect(links(html)).toEqual([]);
    expect(html).toContain("Nothing to click. See beats.md, then talk.");
  });

  it("does not mistake a file path for an address", () => {
    expect(links(render("Open index.ts and app/root.tsx."))).toEqual([]);
  });

  it("does not find an address inside a longer word", () => {
    expect(links(render("The file is named nowww.example.com.txt"))).toEqual(
      []
    );
  });

  // A protocol with nothing behind it is a line to read out, not somewhere to
  // send anyone — and an empty anchor is invisible on the glass.
  it("leaves a protocol with no address behind it as words", () => {
    const html = render("Type https://, then the domain.");
    expect(links(html)).toEqual([]);
    expect(html).toContain("Type https://, then the domain.");
  });

  it("renders nothing for an empty note", () => {
    expect(render("")).toBe("");
  });

  it("shortens a long address on the glass", () => {
    const [link] = links(
      render("https://example.com/a/really/long/path/that/goes/on?q=1")
    );
    expect(link?.text.endsWith("…")).toBe(true);
    expect(link?.text.length).toBeLessThanOrEqual(TYPE.measure);
  });

  // The protocol and a bare `www.` are never spoken and never read, and on a
  // measure this narrow they're a third of the line. Only the label is cut —
  // the address it points at stays whole.
  it("drops the protocol and www from the label, not from the link", () => {
    const [link] = links(render("Go to https://www.example.com/ now."));
    expect(link?.text).toBe("example.com");
    expect(link?.href).toBe("https://www.example.com/");
  });

  it("truncates the label from the end, so the host survives", () => {
    const [link] = links(
      render("https://example.com/a/really/long/path/that/goes/on")
    );
    expect(link?.text).toMatch(/^example\.com\/.*…$/);
  });
});
