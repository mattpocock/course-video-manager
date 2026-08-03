import { describe, expect, it } from "vitest";
import {
  buildSectionScripts,
  scriptPreview,
  scriptVideoIds,
  type SectionForScripts,
} from "./section-scripts-utils";

function makeSection(lessons: SectionForScripts["lessons"]): SectionForScripts {
  return { lessons };
}

describe("buildSectionScripts", () => {
  it("preserves lesson and video order as given", () => {
    const result = buildSectionScripts(
      makeSection([
        {
          id: "l1",
          title: "First",
          path: "first",
          videos: [
            { id: "v1", title: "Intro", script: "a" },
            { id: "v2", title: "Deep dive", script: "b" },
          ],
        },
        {
          id: "l2",
          title: "Second",
          path: "second",
          videos: [{ id: "v3", title: "Wrap", script: "c" }],
        },
      ])
    );

    expect(result.map((l) => l.lessonId)).toEqual(["l1", "l2"]);
    expect(result[0]!.videos.map((v) => v.videoId)).toEqual(["v1", "v2"]);
  });

  it("drops lessons with no videos", () => {
    const result = buildSectionScripts(
      makeSection([
        { id: "l1", title: "Empty", path: "empty", videos: [] },
        {
          id: "l2",
          title: "Has one",
          path: "has-one",
          videos: [{ id: "v1", title: "Only", script: "x" }],
        },
      ])
    );

    expect(result.map((l) => l.lessonId)).toEqual(["l2"]);
  });

  it("normalises missing and null scripts to empty strings", () => {
    const result = buildSectionScripts(
      makeSection([
        {
          id: "l1",
          title: "Mixed",
          path: "mixed",
          videos: [
            { id: "v1", title: "Null", script: null },
            { id: "v2", title: "Absent" },
            { id: "v3", title: "Present", script: "written" },
          ],
        },
      ])
    );

    expect(result[0]!.videos.map((v) => v.script)).toEqual(["", "", "written"]);
  });

  it("yields an empty document when no lesson has any videos", () => {
    const result = buildSectionScripts(
      makeSection([
        { id: "l1", title: "Empty one", path: "empty-one", videos: [] },
        { id: "l2", title: "Empty two", path: "empty-two", videos: [] },
      ])
    );

    expect(result).toEqual([]);
  });

  it("falls back to the lesson path when the title is null or empty", () => {
    const result = buildSectionScripts(
      makeSection([
        {
          id: "l1",
          title: null,
          path: "the-path",
          videos: [{ id: "v1", title: "V", script: "s" }],
        },
      ])
    );

    expect(result[0]!.heading).toBe("the-path");
  });
});

describe("scriptVideoIds", () => {
  it("lists every video in document order, across lessons", () => {
    const document = buildSectionScripts(
      makeSection([
        {
          id: "l1",
          title: "First",
          path: "first",
          videos: [
            { id: "v1", title: "Intro" },
            { id: "v2", title: "Deep dive" },
          ],
        },
        {
          id: "l2",
          title: "Second",
          path: "second",
          videos: [{ id: "v3", title: "Wrap" }],
        },
      ])
    );

    expect(scriptVideoIds(document)).toEqual(["v1", "v2", "v3"]);
  });

  it("is empty for an empty document", () => {
    expect(scriptVideoIds([])).toEqual([]);
  });
});

describe("scriptPreview", () => {
  it("summarises a collapsed script with its first line", () => {
    expect(scriptPreview("Hello there.\nSecond line.")).toBe("Hello there.");
  });

  it("skips leading blank lines", () => {
    expect(scriptPreview("\n\n   \nThe real opening")).toBe("The real opening");
  });

  it("collapses runs of whitespace inside the line", () => {
    expect(scriptPreview("So\t\ttoday   we build")).toBe("So today we build");
  });

  it("truncates a long line with an ellipsis", () => {
    const preview = scriptPreview("word ".repeat(60));
    expect(preview!.length).toBeLessThanOrEqual(101);
    expect(preview!.endsWith("…")).toBe(true);
    // Cuts at a word boundary rather than mid-word.
    expect(preview).not.toMatch(/wor…$/);
  });

  it("has nothing to show for a blank script", () => {
    expect(scriptPreview("")).toBe(null);
    expect(scriptPreview("   \n\t\n")).toBe(null);
  });
});
