import { describe, expect, it } from "vitest";
import { generateChangelog } from "./changelog-service";

type VersionWithStructure = Parameters<typeof generateChangelog>[0][number];
type Video =
  VersionWithStructure["sections"][number]["lessons"][number]["videos"][number];

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

function makeSection(
  id: string,
  path: string,
  lessons: VersionWithStructure["sections"][number]["lessons"],
  previousVersionSectionId: string | null = null
): VersionWithStructure["sections"][number] {
  return { id, path, previousVersionSectionId, lessons };
}

function makeVideo(path: string, transcript: Video["transcript"]): Video {
  return { id: `video-${path}`, path, transcript };
}

describe("changelog Chapter changes", () => {
  it("treats a Chapter rename as a first-class video update", () => {
    const prevVersion = makeVersion("v1", "v1.0", [
      makeSection("s1", "01-intro", [
        {
          id: "l1",
          path: "01.01-welcome",
          previousVersionLessonId: null,
          authoringStatus: "done",
          videos: [
            makeVideo("Problem", [
              { type: "section", name: "Old Section Name" },
              { type: "clip", text: "Hello there." },
            ]),
          ],
        },
      ]),
    ]);

    const currentVersion = makeVersion("v2", "v2.0", [
      makeSection(
        "s2",
        "01-intro",
        [
          {
            id: "l2",
            path: "01.01-welcome",
            previousVersionLessonId: "l1",
            authoringStatus: "done",
            videos: [
              makeVideo("Problem", [
                { type: "section", name: "New Section Name" },
                { type: "clip", text: "Hello there." },
              ]),
            ],
          },
        ],
        "s1"
      ),
    ]);

    const changelog = generateChangelog([currentVersion, prevVersion]);

    expect(changelog).toContain("- ## Old Section Name");
    expect(changelog).toContain("+ ## New Section Name");
    expect(changelog).toContain("Updated");
  });
});
