import { describe, expect, it } from "vitest";
import { generateChangelog } from "./changelog-service";

type VersionWithStructure = Parameters<typeof generateChangelog>[0][number];
type Video =
  VersionWithStructure["sections"][number]["lessons"][number]["videos"][number];

function makeVideo(videoTitle: string, clipTexts: string[] = []): Video {
  return {
    id: `video-${videoTitle}`,
    title: videoTitle,
    transcript: clipTexts.map((text) => ({ type: "clip", text })),
  };
}

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
    videos: clipTexts.length > 0 ? [makeVideo("Problem", clipTexts)] : [],
  };
}

function makeLessonWithVideos(
  id: string,
  path: string,
  previousVersionLessonId: string | null,
  videos: Video[]
): VersionWithStructure["sections"][number]["lessons"][number] {
  return {
    id,
    path,
    previousVersionLessonId,
    authoringStatus: "done",
    videos,
  };
}

function makeLessonWithEmptyVideo(
  id: string,
  path: string,
  previousVersionLessonId: string | null = null
): VersionWithStructure["sections"][number]["lessons"][number] {
  return {
    id,
    path,
    previousVersionLessonId,
    authoringStatus: "done",
    videos: [makeVideo("Problem")],
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
  return {
    id,
    name,
    description: "",
    createdAt: new Date(),
    sections,
  };
}

describe("changelog-service", () => {
  describe("ghost to real lesson transitions", () => {
    it("detects a ghost-to-real transition as a new lesson", () => {
      // Previous version: ghost lesson was filtered out, so it's not in the data
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, ["Hello"]),
        ]),
      ]);

      // Current version: the lesson is now real, but references the ghost lesson ID
      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l2", "01.01-welcome", "l1", ["Hello"]),
            // Ghost became real - has previousVersionLessonId pointing to a ghost
            // that was filtered out of prevVersion
            makeLesson("l3", "01.02-setup", "ghost-l1", ["Setup guide"]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("New Lessons");
      expect(changelog).toContain("01.02-setup");
    });

    it("detects a real-to-ghost transition as a deleted lesson", () => {
      // Previous version: lesson was real
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, ["Hello"]),
          makeLesson("l2", "01.02-setup", null, ["Setup"]),
        ]),
      ]);

      // Current version: the lesson became ghost, so it's filtered out
      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l3", "01.01-welcome", "l1", ["Hello"]),
            // l2 is now ghost - filtered out, not present in the data
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("Deleted");
      expect(changelog).toContain("01.02-setup");
    });

    it("shows transcript diff in details/summary when content changes", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, [
            "Hello and welcome.",
            "Let's get started.",
          ]),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l2", "01.01-welcome", "l1", [
              "Hello and welcome.",
              "Let's get started.",
              "Here is a new section.",
            ]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("<details>");
      expect(changelog).toContain("<summary>");
      expect(changelog).toContain("</details>");
      expect(changelog).toContain("+ Here is a new section.");
    });

    it("shows removed clips with minus prefix", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, [
            "Hello and welcome.",
            "This will be removed.",
            "Let's get started.",
          ]),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l2", "01.01-welcome", "l1", [
              "Hello and welcome.",
              "Let's get started.",
            ]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("- This will be removed.");
    });

    it("shows only context lines around changes, not the full transcript", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, [
            "Line one.",
            "Line two.",
            "Line three.",
            "Line four.",
            "Line five.",
            "Line six.",
            "Line seven.",
            "Line eight.",
            "Line nine.",
            "Line ten.",
          ]),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l2", "01.01-welcome", "l1", [
              "Line one.",
              "Line two.",
              "Line three.",
              "Line four.",
              "Line five CHANGED.",
              "Line six.",
              "Line seven.",
              "Line eight.",
              "Line nine.",
              "Line ten.",
            ]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      // Should show context around the change
      expect(changelog).toContain("Line three.");
      expect(changelog).toContain("Line four.");
      expect(changelog).toContain("- Line five.");
      expect(changelog).toContain("+ Line five CHANGED.");
      expect(changelog).toContain("Line six.");
      expect(changelog).toContain("Line seven.");
      expect(changelog).toContain("Line eight.");
      // Should NOT show lines far from the change
      expect(changelog).not.toContain("Line one.");
      expect(changelog).not.toContain("Line ten.");
    });

    it("separates non-contiguous hunks with ellipsis", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, [
            "A1.",
            "A2.",
            "A3.",
            "A4.",
            "A5.",
            "A6.",
            "A7.",
            "A8.",
            "A9.",
            "A10.",
            "A11.",
            "A12.",
            "A13.",
            "A14.",
            "A15.",
          ]),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l2", "01.01-welcome", "l1", [
              "A1.",
              "A2 CHANGED.",
              "A3.",
              "A4.",
              "A5.",
              "A6.",
              "A7.",
              "A8.",
              "A9.",
              "A10.",
              "A11.",
              "A12.",
              "A13.",
              "A14 CHANGED.",
              "A15.",
            ]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("...");
      expect(changelog).toContain("- A2.");
      expect(changelog).toContain("+ A2 CHANGED.");
      expect(changelog).toContain("- A14.");
      expect(changelog).toContain("+ A14 CHANGED.");
    });

    it("trims clip text in diffs", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, ["  Hello  "]),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l2", "01.01-welcome", "l1", [
              "  Hello  ",
              "  New clip  ",
            ]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("Hello");
      expect(changelog).toContain("+ New clip");
      expect(changelog).not.toContain("  Hello  ");
      expect(changelog).not.toContain("  New clip  ");
    });
  });

  describe("lesson existence based on clips", () => {
    it("does not report a lesson with no clips as new", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, ["Hello"]),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l2", "01.01-welcome", "l1", ["Hello"]),
            // New lesson entity but no clips — should not appear
            makeLesson("l3", "01.02-setup"),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("No significant changes");
      expect(changelog).not.toContain("01.02-setup");
    });

    it("reports a lesson as new when it gains its first clip", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, ["Hello"]),
          // Lesson exists but has no clips
          makeLessonWithEmptyVideo("l2", "01.02-setup"),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l3", "01.01-welcome", "l1", ["Hello"]),
            // Now has clips — should be treated as new
            makeLesson("l4", "01.02-setup", "l2", ["Setup guide"]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("01.02-setup");
      expect(changelog).toContain("New Lessons");
    });

    it("reports a lesson as deleted when it loses all clips", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, ["Hello"]),
          makeLesson("l2", "01.02-setup", null, ["Setup guide"]),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l3", "01.01-welcome", "l1", ["Hello"]),
            // Lesson still exists but lost all clips
            makeLessonWithEmptyVideo("l4", "01.02-setup", "l2"),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("Deleted");
      expect(changelog).toContain("01.02-setup");
    });

    it("does not report changes when lesson had no clips and still has none", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, ["Hello"]),
          makeLessonWithEmptyVideo("l2", "01.02-setup"),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l3", "01.01-welcome", "l1", ["Hello"]),
            makeLessonWithEmptyVideo("l4", "01.02-setup", "l2"),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("No significant changes");
    });

    it("shows no significant changes when nothing changed", () => {
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

      expect(changelog).toContain("No significant changes");
    });
  });

  describe("draft version filtering", () => {
    it("excludes draft versions (empty name) from changelog", () => {
      const publishedVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, ["Hello"]),
        ]),
      ]);

      // Draft version has empty name
      const draftVersion = makeVersion("v2", "", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l2", "01.01-welcome", "l1", ["Hello"]),
            makeLesson("l3", "01.02-setup", null, ["Setup guide"]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([draftVersion, publishedVersion]);

      // Draft should be filtered out — only published version appears
      expect(changelog).not.toContain("01.02-setup");
      expect(changelog).toContain("v1.0");
      expect(changelog).toContain("Initial version.");
    });

    it("includes draft when name is overridden at publish time", () => {
      const publishedVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, ["Hello"]),
        ]),
      ]);

      // Simulates publish flow: draft name overridden to publish name
      const aboutToPublish = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l2", "01.01-welcome", "l1", ["Hello"]),
            makeLesson("l3", "01.02-setup", null, ["Setup guide"]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([aboutToPublish, publishedVersion]);

      expect(changelog).toContain("v2.0");
      expect(changelog).toContain("New Lessons");
      expect(changelog).toContain("01.02-setup");
    });

    it("returns no versions found when only a draft exists", () => {
      const draftVersion = makeVersion("v1", "", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, ["Hello"]),
        ]),
      ]);

      const changelog = generateChangelog([draftVersion]);

      expect(changelog).toContain("No versions found.");
    });
  });

  describe("video-level changelog tracking", () => {
    it("shows the video path when a video is updated", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLessonWithVideos("l1", "01.01-welcome", null, [
            makeVideo("Problem", ["Hello", "World"]),
          ]),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLessonWithVideos("l2", "01.01-welcome", "l1", [
              makeVideo("Problem", ["Hello", "World", "Updated"]),
            ]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("Updated");
      expect(changelog).toContain("01.01-welcome");
      expect(changelog).toContain("Problem");
      expect(changelog).toContain("updated");
    });
    it("shows new video added to existing lesson", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLessonWithVideos("l1", "01.01-welcome", null, [
            makeVideo("Problem", ["What is TypeScript?"]),
          ]),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLessonWithVideos("l2", "01.01-welcome", "l1", [
              makeVideo("Problem", ["What is TypeScript?"]),
              makeVideo("Solution", ["TypeScript is a typed superset."]),
            ]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("Updated");
      expect(changelog).toContain("01.01-welcome");
      expect(changelog).toContain("Solution");
      expect(changelog).toContain("new video");
    });

    it("shows deleted video within an existing lesson", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLessonWithVideos("l1", "01.01-welcome", null, [
            makeVideo("Problem", ["What is TypeScript?"]),
            makeVideo("Solution", ["TypeScript is a typed superset."]),
          ]),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLessonWithVideos("l2", "01.01-welcome", "l1", [
              makeVideo("Problem", ["What is TypeScript?"]),
              // Solution video removed
            ]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("Updated");
      expect(changelog).toContain("01.01-welcome");
      expect(changelog).toContain("Solution");
      expect(changelog).toContain("deleted");
    });

    it("lists videos under new lessons", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, ["Hello"]),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l2", "01.01-welcome", "l1", ["Hello"]),
            makeLessonWithVideos("l3", "01.02-setup", null, [
              makeVideo("Problem", ["Set up your env"]),
              makeVideo("Solution", ["Install node"]),
            ]),
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("New Lessons");
      expect(changelog).toContain("01.02-setup");
      expect(changelog).toContain("Problem");
      expect(changelog).toContain("Solution");
    });

    it("lists videos under deleted lessons", () => {
      const prevVersion = makeVersion("v1", "v1.0", [
        makeSection("s1", "01-intro", [
          makeLesson("l1", "01.01-welcome", null, ["Hello"]),
          makeLessonWithVideos("l2", "01.02-setup", null, [
            makeVideo("Problem", ["Set up"]),
            makeVideo("Solution", ["Done"]),
          ]),
        ]),
      ]);

      const currentVersion = makeVersion("v2", "v2.0", [
        makeSection(
          "s2",
          "01-intro",
          [
            makeLesson("l3", "01.01-welcome", "l1", ["Hello"]),
            // l2 removed entirely
          ],
          "s1"
        ),
      ]);

      const changelog = generateChangelog([currentVersion, prevVersion]);

      expect(changelog).toContain("Deleted");
      expect(changelog).toContain("01.02-setup");
      expect(changelog).toContain("Problem");
      expect(changelog).toContain("Solution");
    });
  });
});
