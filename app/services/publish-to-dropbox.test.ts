import { describe, expect, it } from "vitest";
import { buildChapters, resolveSectionsWithVideos } from "./publish-to-dropbox";
import { Effect } from "effect";
import { FileSystem } from "@effect/platform";

const FINISHED_VIDEOS_DIR = "/videos";

const run = (opts: {
  sectionsOnFileSystem: Parameters<
    typeof resolveSectionsWithVideos
  >[0]["sectionsOnFileSystem"];
  sectionsInDb: Parameters<typeof resolveSectionsWithVideos>[0]["sectionsInDb"];
  existingFiles: string[];
}) =>
  resolveSectionsWithVideos({
    sectionsOnFileSystem: opts.sectionsOnFileSystem,
    sectionsInDb: opts.sectionsInDb,
    finishedVideosDirectory: FINISHED_VIDEOS_DIR,
  }).pipe(
    Effect.provide(
      FileSystem.layerNoop({
        exists: (path) =>
          Effect.succeed(opts.existingFiles.includes(path as string)),
      })
    ),
    Effect.runPromise
  );

describe("resolveSectionsWithVideos", () => {
  it("should resolve all videos when all exist locally", async () => {
    const result = await run({
      sectionsOnFileSystem: [
        {
          sectionPathWithNumber: "001-intro",
          lessons: [{ lessonPathWithNumber: "001-getting-started" }],
        },
      ],
      sectionsInDb: [
        {
          id: "section-1",
          path: "001-intro",
          lessons: [
            {
              id: "lesson-1",
              path: "001-getting-started",
              videos: [{ id: "video-1", path: "getting-started" }],
            },
          ],
        },
      ],
      existingFiles: ["/videos/video-1.mp4"],
    });

    expect(result.missingVideos).toEqual([]);
    expect(result.sections).toEqual([
      {
        id: "section-1",
        path: "001-intro",
        lessons: [
          {
            id: "lesson-1",
            path: "001-getting-started",
            videos: [
              {
                id: "video-1",
                absolutePath: "/videos/video-1.mp4",
                name: "getting-started",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("should collect missing videos instead of failing", async () => {
    const result = await run({
      sectionsOnFileSystem: [
        {
          sectionPathWithNumber: "001-intro",
          lessons: [{ lessonPathWithNumber: "001-getting-started" }],
        },
      ],
      sectionsInDb: [
        {
          id: "section-1",
          path: "001-intro",
          lessons: [
            {
              id: "lesson-1",
              path: "001-getting-started",
              videos: [
                { id: "video-1", path: "getting-started" },
                { id: "video-2", path: "next-steps" },
              ],
            },
          ],
        },
      ],
      existingFiles: ["/videos/video-1.mp4"],
    });

    expect(result.missingVideos).toEqual([
      {
        videoId: "video-2",
        videoPath: "next-steps",
        lessonPath: "001-getting-started",
      },
    ]);

    expect(result.sections[0]!.lessons[0]!.videos).toEqual([
      {
        id: "video-1",
        absolutePath: "/videos/video-1.mp4",
        name: "getting-started",
      },
    ]);
  });

  it("should report all videos as missing when none exist locally", async () => {
    const result = await run({
      sectionsOnFileSystem: [
        {
          sectionPathWithNumber: "001-intro",
          lessons: [{ lessonPathWithNumber: "001-getting-started" }],
        },
      ],
      sectionsInDb: [
        {
          id: "section-1",
          path: "001-intro",
          lessons: [
            {
              id: "lesson-1",
              path: "001-getting-started",
              videos: [
                { id: "video-1", path: "getting-started" },
                { id: "video-2", path: "next-steps" },
              ],
            },
          ],
        },
      ],
      existingFiles: [],
    });

    expect(result.missingVideos).toHaveLength(2);
    expect(result.sections[0]!.lessons[0]!.videos).toEqual([]);
  });

  it("should still include lessons with no videos in the structure", async () => {
    const result = await run({
      sectionsOnFileSystem: [
        {
          sectionPathWithNumber: "001-intro",
          lessons: [{ lessonPathWithNumber: "001-getting-started" }],
        },
      ],
      sectionsInDb: [
        {
          id: "section-1",
          path: "001-intro",
          lessons: [
            {
              id: "lesson-1",
              path: "001-getting-started",
              videos: [],
            },
          ],
        },
      ],
      existingFiles: [],
    });

    expect(result.missingVideos).toEqual([]);
    expect(result.sections).toEqual([
      {
        id: "section-1",
        path: "001-intro",
        lessons: [
          {
            id: "lesson-1",
            path: "001-getting-started",
            videos: [],
          },
        ],
      },
    ]);
  });

  it("should handle multiple sections with mixed video availability", async () => {
    const result = await run({
      sectionsOnFileSystem: [
        {
          sectionPathWithNumber: "001-intro",
          lessons: [{ lessonPathWithNumber: "001-basics" }],
        },
        {
          sectionPathWithNumber: "002-advanced",
          lessons: [{ lessonPathWithNumber: "001-deep-dive" }],
        },
      ],
      sectionsInDb: [
        {
          id: "section-1",
          path: "001-intro",
          lessons: [
            {
              id: "lesson-1",
              path: "001-basics",
              videos: [{ id: "video-1", path: "basics" }],
            },
          ],
        },
        {
          id: "section-2",
          path: "002-advanced",
          lessons: [
            {
              id: "lesson-2",
              path: "001-deep-dive",
              videos: [{ id: "video-2", path: "deep-dive" }],
            },
          ],
        },
      ],
      existingFiles: ["/videos/video-1.mp4"],
    });

    expect(result.sections[0]!.lessons[0]!.videos).toHaveLength(1);
    expect(result.sections[1]!.lessons[0]!.videos).toHaveLength(0);
    expect(result.missingVideos).toEqual([
      {
        videoId: "video-2",
        videoPath: "deep-dive",
        lessonPath: "001-deep-dive",
      },
    ]);
  });
});

describe("buildChapters", () => {
  const clip = (order: string, duration: number) => ({
    order,
    sourceStartTime: 0,
    sourceEndTime: duration,
  });
  const section = (order: string, name: string) => ({ order, name });

  it("returns null when there are no chapters", () => {
    expect(buildChapters([clip("a0", 10)], [])).toBeNull();
  });

  it("returns null when every chapter is zero-length", () => {
    // Two sections back-to-back with no clips between them and nothing after.
    expect(
      buildChapters([clip("a0", 5)], [section("a1", "A"), section("a2", "B")])
    ).toBeNull();
  });

  it("computes startTime as the floored sum of preceding clip durations", () => {
    const result = buildChapters(
      [clip("a0", 22.4), clip("a2", 13.9), clip("a4", 44.2)],
      [section("a1", "Intro topic"), section("a3", "Next topic")]
    );
    expect(result).toEqual([
      { title: "Intro", startTime: 0 },
      { title: "Intro topic", startTime: 22 },
      { title: "Next topic", startTime: 36 },
    ]);
  });

  it("prepends a synthetic Intro chapter when the first chapter is not at 0", () => {
    const result = buildChapters(
      [clip("a0", 10), clip("a2", 10)],
      [section("a1", "Second segment")]
    );
    expect(result).toEqual([
      { title: "Intro", startTime: 0 },
      { title: "Second segment", startTime: 10 },
    ]);
  });

  it("does not prepend Intro when the first chapter already starts at 0", () => {
    const result = buildChapters(
      [clip("a1", 10), clip("a2", 5)],
      [section("a0", "Welcome")]
    );
    expect(result).toEqual([{ title: "Welcome", startTime: 0 }]);
  });

  it("drops zero-length chapters between non-empty ones", () => {
    // Section B has no clips before C → B is zero-length and dropped.
    const result = buildChapters(
      [clip("a1", 10), clip("a4", 5)],
      [section("a0", "A"), section("a2", "B"), section("a3", "C")]
    );
    expect(result).toEqual([
      { title: "A", startTime: 0 },
      { title: "C", startTime: 10 },
    ]);
  });

  it("drops a trailing zero-length chapter", () => {
    const result = buildChapters([clip("a0", 10)], [section("a1", "Trailing")]);
    expect(result).toBeNull();
  });
});
