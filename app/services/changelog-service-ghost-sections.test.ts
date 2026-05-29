import { describe, expect, it } from "vitest";
import { generateChangelog } from "./changelog-service";

type VersionWithStructure = Parameters<typeof generateChangelog>[0][number];

function makeLesson(
  id: string,
  path: string,
  previousVersionLessonId: string | null = null,
  clipTexts: string[] = []
): VersionWithStructure["sections"][number]["lessons"][number] {
  return {
    id,
    path,
    previousVersionLessonId,
    authoringStatus: "done",
    videos:
      clipTexts.length > 0
        ? [
            {
              id: `video-${path}`,
              path: "Problem",
              transcript: clipTexts.map((text) => ({ type: "clip", text })),
            },
          ]
        : [],
  };
}

function makeSection(
  id: string,
  path: string,
  lessons: VersionWithStructure["sections"][number]["lessons"],
  previousVersionSectionId: string | null = null
): VersionWithStructure["sections"][number] {
  return { id, path, previousVersionSectionId, lessons };
}

function makeVersion(
  id: string,
  name: string,
  sections: VersionWithStructure["sections"]
): VersionWithStructure {
  return { id, name, description: "", createdAt: new Date(), sections };
}

describe("ghost sections excluded from changelog", () => {
  it("does not show a ghost section that was renamed between versions", () => {
    const prevVersion = makeVersion("v1", "v1.0", [
      makeSection("s1", "01-intro", [
        makeLesson("l1", "01.01-welcome", null, ["Hello"]),
      ]),
      makeSection("gs1", "Advanced Topics", []),
    ]);

    const currentVersion = makeVersion("v2", "v2.0", [
      makeSection(
        "s2",
        "01-intro",
        [makeLesson("l2", "01.01-welcome", "l1", ["Hello"])],
        "s1"
      ),
      makeSection("gs2", "Future Content", [], "gs1"),
    ]);

    const changelog = generateChangelog([currentVersion, prevVersion]);

    expect(changelog).not.toContain("Advanced Topics");
    expect(changelog).not.toContain("Future Content");
    expect(changelog).not.toContain("Renamed from");
  });

  it("does not show a ghost section as deleted", () => {
    const prevVersion = makeVersion("v1", "v1.0", [
      makeSection("s1", "01-intro", [
        makeLesson("l1", "01.01-welcome", null, ["Hello"]),
      ]),
      makeSection("gs1", "Planned Section", []),
    ]);

    const currentVersion = makeVersion("v2", "v2.0", [
      makeSection(
        "s2",
        "01-intro",
        [makeLesson("l2", "01.01-welcome", "l1", ["Hello"])],
        "s1"
      ),
    ]);

    const changelog = generateChangelog([currentVersion, prevVersion]);

    expect(changelog).not.toContain("Planned Section");
    expect(changelog).not.toContain("Deleted Sections");
  });

  it("does not show a new ghost section with lessons", () => {
    const prevVersion = makeVersion("v1", "v1.0", [
      makeSection("s1", "01-intro", [
        makeLesson("l1", "01.01-welcome", null, ["Hello"]),
      ]),
    ]);

    const currentVersion = makeVersion("v2", "v2.0", [
      makeSection(
        "s2",
        "01-intro",
        [makeLesson("l2", "01.01-welcome", "l1", ["Hello"])],
        "s1"
      ),
      makeSection("gs1", "Upcoming Section", [
        makeLesson("gl1", "future-lesson", null, ["Some content"]),
      ]),
    ]);

    const changelog = generateChangelog([currentVersion, prevVersion]);

    expect(changelog).not.toContain("Upcoming Section");
    expect(changelog).not.toContain("future-lesson");
  });
});
