import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BeatsView, isSelectingText } from "./beats-view";

const render = (description: string) =>
  renderToStaticMarkup(
    <BeatsView
      beats={[
        { id: "beat-1", kind: "definition", title: "The setup", description },
      ]}
    />
  );

/** Every `font-size` the row set, in document order: the title, then the note. */
const fontSizes = (html: string) =>
  [...html.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) =>
    Number(match[1])
  );

/** A selection as the browser hands one back. */
const selection = (text: string) =>
  ({
    isCollapsed: text === "",
    toString: () => text,
  }) as unknown as Selection;

describe("BeatsView", () => {
  // Beat descriptions are pasted notes as often as written ones, so a URL or a
  // long path turns up here too — and must not run off the right edge.
  it("breaks a word too long for the measure instead of overflowing", () => {
    expect(render("https://example.com/a/really/long/path")).toMatch(
      /overflow-wrap:\s*anywhere/
    );
  });

  it("links an address in a beat's description", () => {
    const html = render("Show https://example.com/pricing on screen.");
    expect(html).toContain('href="https://example.com/pricing"');
    expect(html).toContain('target="_blank"');
  });

  it("leaves a description with no address alone", () => {
    expect(render("Walk through the setup.")).toContain(
      "Walk through the setup."
    );
  });

  // The title is the beat you're looking for; the description is the detail you
  // read once you've found it. Same size makes the plan one undifferentiated
  // wall of text at a glance.
  it("sets a description smaller than the title it belongs to", () => {
    const [title, description] = fontSizes(render("Walk through the setup."));
    expect(title).toBeGreaterThan(0);
    expect(description).toBeLessThan(title!);
  });

  // Small, but still glass-at-arm's-length legible rather than fine print.
  it("keeps the description well clear of the cue size", () => {
    const [, description] = fontSizes(render("Walk through the setup."));
    expect(description).toBeGreaterThan(16);
  });

  // A note on the glass is as often something to paste elsewhere as something
  // to read out.
  it("lets the text be selected", () => {
    expect(render("Walk through the setup.")).toMatch(/user-select:\s*text/);
  });
});

describe("isSelectingText", () => {
  it("is false with nothing selected", () => {
    expect(isSelectingText(null)).toBe(false);
    expect(isSelectingText(selection(""))).toBe(false);
  });

  // A plain click leaves a collapsed selection at the caret, and that must
  // still move the spotlight.
  it("is false for a selection of whitespace alone", () => {
    expect(isSelectingText(selection("  \n "))).toBe(false);
  });

  it("is true once words are highlighted", () => {
    expect(isSelectingText(selection("the setup"))).toBe(true);
  });
});
