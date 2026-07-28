import { describe, it, expect } from "vitest";
import {
  preprocessChooseScreenshotMarkdown,
  mapPreprocessedOffsetToSource,
} from "./choose-screenshot-markdown";

describe("preprocessChooseScreenshotMarkdown", () => {
  it("rewrites a JSX tag into a lowercase HTML element", () => {
    expect(
      preprocessChooseScreenshotMarkdown(
        `<ChooseScreenshot clipIndex={1} alt="a" />`
      )
    ).toBe(`<choosescreenshot clipindex="1" alt="a"></choosescreenshot>`);
  });

  it("leaves markdown without screenshot tags alone", () => {
    const md = `# Title\n\nJust prose.\n`;
    expect(preprocessChooseScreenshotMarkdown(md)).toBe(md);
  });
});

describe("mapPreprocessedOffsetToSource", () => {
  it("is the identity when there are no screenshot tags", () => {
    const source = `# Title\n\nFirst para.\n`;
    const offset = source.indexOf("First para.");
    expect(mapPreprocessedOffsetToSource(source, offset)).toBe(offset);
  });

  it("leaves offsets before the first tag unchanged", () => {
    const source = `Intro.\n\n<ChooseScreenshot clipIndex={1} alt="a" />\n\nAfter.\n`;
    const rendered = preprocessChooseScreenshotMarkdown(source);
    expect(
      mapPreprocessedOffsetToSource(source, rendered.indexOf("Intro."))
    ).toBe(source.indexOf("Intro."));
  });

  it("shifts offsets that follow a rewritten tag", () => {
    const source = `Intro.\n\n<ChooseScreenshot clipIndex={1} alt="a" />\n\nAfter.\n`;
    const rendered = preprocessChooseScreenshotMarkdown(source);
    expect(
      mapPreprocessedOffsetToSource(source, rendered.indexOf("After."))
    ).toBe(source.indexOf("After."));
  });

  it("accumulates the shift across several tags", () => {
    const source = [
      `One.`,
      `<ChooseScreenshot clipIndex={1} alt="a" />`,
      `Two.`,
      `<ChooseScreenshot clipIndex={2} alt="a much longer caption" />`,
      `Three.`,
    ].join("\n\n");
    const rendered = preprocessChooseScreenshotMarkdown(source);

    for (const block of ["One.", "Two.", "Three."]) {
      expect(
        mapPreprocessedOffsetToSource(source, rendered.indexOf(block))
      ).toBe(source.indexOf(block));
    }
  });

  it("maps the start of a rewritten tag back to the start of the source tag", () => {
    const source = `Intro.\n\n<ChooseScreenshot clipIndex={1} alt="a" />\n`;
    const rendered = preprocessChooseScreenshotMarkdown(source);
    expect(
      mapPreprocessedOffsetToSource(
        source,
        rendered.indexOf("<choosescreenshot")
      )
    ).toBe(source.indexOf("<ChooseScreenshot"));
  });
});
