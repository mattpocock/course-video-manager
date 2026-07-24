import { describe, expect, it } from "vitest";
import {
  buildSectionScripts,
  type SectionForScripts,
} from "./section-scripts-utils";

function makeSection(
  lessons: SectionForScripts["lessons"]
): SectionForScripts {
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
