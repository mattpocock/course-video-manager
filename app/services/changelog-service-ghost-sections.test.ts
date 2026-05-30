import { describe, expect, it } from "vitest";
import { generateChangelog } from "./changelog-service";
import { detectChanges } from "./changelog-detection";

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
  it("does not report changes when versions only differ by a removed ghost section", () => {
    // Ghost sections are filtered at the DB layer, so they never appear in
    // VersionWithStructure. This test verifies that two identical real
    // structures produce no changelog entries (the ghost section that existed
    // in the DB was already stripped before reaching detectChanges).
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
    ]);

    const changelog = generateChangelog([currentVersion, prevVersion]);

    expect(changelog).not.toContain("Deleted Sections");
    expect(changelog).not.toContain("Renamed from");
  });

  it("returns no spurious changes for matching real sections", () => {
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
    ]);

    const changes = detectChanges(currentVersion, prevVersion);

    expect(changes).not.toBeNull();
    expect(changes!.newLessons).toHaveLength(0);
    expect(changes!.deletedSections).toHaveLength(0);
    expect(changes!.deletedLessons).toHaveLength(0);
    expect(changes!.renamedSections).toHaveLength(0);
  });

  it("correctly detects a deleted lesson when its only reference was from a ghost section", () => {
    // In the DB, lesson l2 was referenced by a ghost section's lesson. After
    // ghost section filtering at the DB layer, that reference is gone, so l2
    // should appear as deleted from its original real section.
    const prevVersion = makeVersion("v1", "v1.0", [
      makeSection("s1", "01-intro", [
        makeLesson("l1", "01.01-welcome", null, ["Hello"]),
        makeLesson("l2", "01.02-setup", null, ["Setup content"]),
      ]),
    ]);

    const currentVersion = makeVersion("v2", "v2.0", [
      makeSection(
        "s2",
        "01-intro",
        [makeLesson("l3", "01.01-welcome", "l1", ["Hello"])],
        "s1"
      ),
    ]);

    const changes = detectChanges(currentVersion, prevVersion);

    expect(changes!.deletedLessons).toEqual([
      {
        sectionPath: "01-intro",
        lessonPath: "01.02-setup",
        videoPaths: ["Problem"],
      },
    ]);
  });
});
