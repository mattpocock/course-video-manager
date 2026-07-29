import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LinkedText, shortenUrl } from "./linked-text";
import { TYPE } from "./teleprompter-settings";

const render = (text: string) =>
  renderToStaticMarkup(<LinkedText>{text}</LinkedText>);

const links = (html: string) =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    attrs: m[1]!,
    href: /href="([^"]*)"/.exec(m[1]!)?.[1] ?? "",
    text: m[2]!,
  }));

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

  it("shortens a long address on the glass", () => {
    const [link] = links(
      render("https://example.com/a/really/long/path/that/goes/on?q=1")
    );
    expect(link?.text.endsWith("…")).toBe(true);
    expect(link?.text.length).toBeLessThanOrEqual(TYPE.measure);
  });
});

describe("shortenUrl", () => {
  it("drops the protocol and a trailing slash", () => {
    expect(shortenUrl("https://example.com/")).toBe("example.com");
  });

  it("drops a leading www, which is four characters of a short line", () => {
    expect(shortenUrl("www.example.com")).toBe("example.com");
  });

  it("keeps an address that fits whole", () => {
    expect(shortenUrl("https://example.com/pricing")).toBe(
      "example.com/pricing"
    );
  });

  it("truncates from the end, so the host survives", () => {
    expect(
      shortenUrl("https://example.com/a/really/long/path/that/goes/on")
    ).toMatch(/^example\.com\/.*…$/);
  });
});
