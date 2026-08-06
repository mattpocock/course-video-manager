import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BeatsView } from "./beats-view";
import { TYPE } from "./teleprompter-settings";

const TITLE = "The setup";
const DESCRIPTION = "Walk through the setup.";

const render = (description: string) =>
  renderToStaticMarkup(
    <BeatsView
      beats={[{ id: "beat-1", kind: "definition", title: TITLE, description }]}
    />
  );

/**
 * The inline style of whatever element renders exactly `text`.
 *
 * Anchored to the words rather than to document order: the row draws an icon
 * and a title before it reaches the description, and a test that picked the
 * second `font-size` it found would silently start reading the wrong element
 * the day anything sized is added in front of it.
 */
const styleOf = (html: string, text: string): string => {
  const element = [...html.matchAll(/style="([^"]*)"[^>]*>([^<]*)</g)].find(
    (match) => match[2] === text
  );
  if (!element) throw new Error(`Nothing in the markup renders "${text}".`);
  return element[1]!;
};

/** The `font-size`, in px, of whatever element renders `text`. */
const fontSizeOf = (html: string, text: string): number => {
  const size = styleOf(html, text).match(/font-size:\s*([\d.]+)px/);
  if (!size) throw new Error(`"${text}" is rendered without a font-size.`);
  return Number(size[1]);
};

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
    expect(render(DESCRIPTION)).toContain(DESCRIPTION);
  });

  // The plan is glanced at from wherever you're standing, in whole rows rather
  // than word by word, so it is set a step above the script's body type — the
  // size tuned for reading a line aloud off the glass.
  it("sets a beat's title above the size the script reads at", () => {
    expect(fontSizeOf(render(DESCRIPTION), TITLE)).toBeGreaterThan(
      TYPE.fontSize
    );
  });

  // The title is the beat you're looking for; the description is the detail you
  // read once you've found it. Same size makes the plan one undifferentiated
  // wall of text at a glance.
  it("sets a description smaller than the title it belongs to", () => {
    const html = render(DESCRIPTION);
    expect(fontSizeOf(html, DESCRIPTION)).toBeLessThan(fontSizeOf(html, TITLE));
  });

  // Smaller, but not fine print: a description is a sentence of what you're
  // about to actually do, so it has to stay at least as legible as a cue — the
  // smallest thing this design already trusts you to read from where you stand.
  it("keeps the description no smaller than a cue", () => {
    const html = render(DESCRIPTION);
    expect(fontSizeOf(html, DESCRIPTION)).toBeGreaterThanOrEqual(
      TYPE.fontSize * TYPE.cueScale
    );
  });

  // A note on the glass is as often something to paste elsewhere as something
  // to read out, and the whole window is otherwise inert to the pointer.
  it("lets a beat's title and its description be selected", () => {
    const html = render(DESCRIPTION);
    expect(styleOf(html, TITLE)).toMatch(/user-select:\s*text/);
    expect(styleOf(html, DESCRIPTION)).toMatch(/user-select:\s*text/);
  });
});
