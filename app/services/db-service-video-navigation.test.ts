import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";

let testDb: TestDb;
let testLayer: Layer.Layer<VideoOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = VideoOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const buildCourseFixture = async (
  sections: Array<{
    path: string;
    order: number;
    lessons: Array<{
      path: string;
      title: string;
      order: number;
      fsStatus?: string;
      videos: Array<{ path: string; archived?: boolean }>;
    }>;
  }>
) => {
  const [course] = await testDb
    .insert(schema.courses)
    .values({ name: "Test Course", filePath: "/tmp/test-repo" })
    .returning();

  const [version] = await testDb
    .insert(schema.courseVersions)
    .values({ repoId: course!.id, name: "v1" })
    .returning();

  const allVideos: Array<{ id: string; path: string; lessonId: string }> = [];

  for (const sectionDef of sections) {
    const [section] = await testDb
      .insert(schema.sections)
      .values({
        repoVersionId: version!.id,
        path: sectionDef.path,
        order: sectionDef.order,
      })
      .returning();

    for (const lessonDef of sectionDef.lessons) {
      const fsStatus = lessonDef.fsStatus ?? "real";
      const [lesson] = await testDb
        .insert(schema.lessons)
        .values({
          sectionId: section!.id,
          path: lessonDef.path,
          title: lessonDef.title,
          order: lessonDef.order,
          fsStatus,
          authoringStatus: fsStatus === "real" ? "done" : null,
        })
        .returning();

      for (const videoDef of lessonDef.videos) {
        const [video] = await testDb
          .insert(schema.videos)
          .values({
            lessonId: lesson!.id,
            path: videoDef.path,
            originalFootagePath: videoDef.path,
            archived: videoDef.archived ?? false,
          })
          .returning();

        allVideos.push({
          id: video!.id,
          path: video!.path,
          lessonId: lesson!.id,
        });
      }
    }
  }

  return { courseId: course!.id, versionId: version!.id, videos: allVideos };
};

describe("getNextVideoId / getPreviousVideoId", () => {
  describe("standalone video", () => {
    it.effect("returns null for next when video has no lesson", () =>
      Effect.gen(function* () {
        const vOps = yield* VideoOperationsService;
        const video = yield* vOps.createStandaloneVideo({
          path: "standalone.mp4",
        });
        const fetched = yield* vOps.getVideoWithClipsById(video.id);

        const nextId = yield* vOps.getNextVideoId(fetched);
        expect(nextId).toBeNull();
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns null for previous when video has no lesson", () =>
      Effect.gen(function* () {
        const vOps = yield* VideoOperationsService;
        const video = yield* vOps.createStandaloneVideo({
          path: "standalone.mp4",
        });
        const fetched = yield* vOps.getVideoWithClipsById(video.id);

        const prevId = yield* vOps.getPreviousVideoId(fetched);
        expect(prevId).toBeNull();
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("same lesson navigation", () => {
    it.effect("returns next video in same lesson sorted by path", () =>
      Effect.gen(function* () {
        const vOps = yield* VideoOperationsService;
        const fixture = yield* Effect.promise(() =>
          buildCourseFixture([
            {
              path: "section-01",
              order: 1,
              lessons: [
                {
                  path: "lesson-01",
                  title: "Lesson 1",
                  order: 1,
                  videos: [
                    { path: "a.mp4" },
                    { path: "b.mp4" },
                    { path: "c.mp4" },
                  ],
                },
              ],
            },
          ])
        );

        const videoB = fixture.videos.find((v) => v.path === "b.mp4")!;
        const videoC = fixture.videos.find((v) => v.path === "c.mp4")!;
        const fetched = yield* vOps.getVideoWithClipsById(videoB.id);

        const nextId = yield* vOps.getNextVideoId(fetched);
        expect(nextId).toBe(videoC.id);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns previous video in same lesson sorted by path", () =>
      Effect.gen(function* () {
        const vOps = yield* VideoOperationsService;
        const fixture = yield* Effect.promise(() =>
          buildCourseFixture([
            {
              path: "section-01",
              order: 1,
              lessons: [
                {
                  path: "lesson-01",
                  title: "Lesson 1",
                  order: 1,
                  videos: [
                    { path: "a.mp4" },
                    { path: "b.mp4" },
                    { path: "c.mp4" },
                  ],
                },
              ],
            },
          ])
        );

        const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
        const videoB = fixture.videos.find((v) => v.path === "b.mp4")!;
        const fetched = yield* vOps.getVideoWithClipsById(videoB.id);

        const prevId = yield* vOps.getPreviousVideoId(fetched);
        expect(prevId).toBe(videoA.id);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("cross-lesson navigation", () => {
    it.effect(
      "next returns first video of next lesson when at end of current lesson",
      () =>
        Effect.gen(function* () {
          const vOps = yield* VideoOperationsService;
          const fixture = yield* Effect.promise(() =>
            buildCourseFixture([
              {
                path: "section-01",
                order: 1,
                lessons: [
                  {
                    path: "lesson-01",
                    title: "Lesson 1",
                    order: 1,
                    videos: [{ path: "a.mp4" }],
                  },
                  {
                    path: "lesson-02",
                    title: "Lesson 2",
                    order: 2,
                    videos: [{ path: "b.mp4" }],
                  },
                ],
              },
            ])
          );

          const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
          const videoB = fixture.videos.find((v) => v.path === "b.mp4")!;
          const fetched = yield* vOps.getVideoWithClipsById(videoA.id);

          const nextId = yield* vOps.getNextVideoId(fetched);
          expect(nextId).toBe(videoB.id);
        }).pipe(Effect.provide(testLayer))
    );

    it.effect(
      "previous returns last video of previous lesson when at start of current lesson",
      () =>
        Effect.gen(function* () {
          const vOps = yield* VideoOperationsService;
          const fixture = yield* Effect.promise(() =>
            buildCourseFixture([
              {
                path: "section-01",
                order: 1,
                lessons: [
                  {
                    path: "lesson-01",
                    title: "Lesson 1",
                    order: 1,
                    videos: [{ path: "a.mp4" }, { path: "b.mp4" }],
                  },
                  {
                    path: "lesson-02",
                    title: "Lesson 2",
                    order: 2,
                    videos: [{ path: "c.mp4" }],
                  },
                ],
              },
            ])
          );

          const videoB = fixture.videos.find((v) => v.path === "b.mp4")!;
          const videoC = fixture.videos.find((v) => v.path === "c.mp4")!;
          const fetched = yield* vOps.getVideoWithClipsById(videoC.id);

          const prevId = yield* vOps.getPreviousVideoId(fetched);
          expect(prevId).toBe(videoB.id);
        }).pipe(Effect.provide(testLayer))
    );

    it.effect("skips ghost lessons when navigating next", () =>
      Effect.gen(function* () {
        const vOps = yield* VideoOperationsService;
        const fixture = yield* Effect.promise(() =>
          buildCourseFixture([
            {
              path: "section-01",
              order: 1,
              lessons: [
                {
                  path: "lesson-01",
                  title: "Lesson 1",
                  order: 1,
                  videos: [{ path: "a.mp4" }],
                },
                {
                  path: "lesson-02-ghost",
                  title: "Ghost Lesson",
                  order: 2,
                  fsStatus: "ghost",
                  videos: [{ path: "ghost.mp4" }],
                },
                {
                  path: "lesson-03",
                  title: "Lesson 3",
                  order: 3,
                  videos: [{ path: "b.mp4" }],
                },
              ],
            },
          ])
        );

        const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
        const videoB = fixture.videos.find((v) => v.path === "b.mp4")!;
        const fetched = yield* vOps.getVideoWithClipsById(videoA.id);

        const nextId = yield* vOps.getNextVideoId(fetched);
        expect(nextId).toBe(videoB.id);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("crosses section boundaries", () =>
      Effect.gen(function* () {
        const vOps = yield* VideoOperationsService;
        const fixture = yield* Effect.promise(() =>
          buildCourseFixture([
            {
              path: "section-01",
              order: 1,
              lessons: [
                {
                  path: "lesson-01",
                  title: "Lesson 1",
                  order: 1,
                  videos: [{ path: "a.mp4" }],
                },
              ],
            },
            {
              path: "section-02",
              order: 2,
              lessons: [
                {
                  path: "lesson-02",
                  title: "Lesson 2",
                  order: 1,
                  videos: [{ path: "b.mp4" }],
                },
              ],
            },
          ])
        );

        const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
        const videoB = fixture.videos.find((v) => v.path === "b.mp4")!;

        // Next from last video of section 1 → first video of section 2
        const fetchedA = yield* vOps.getVideoWithClipsById(videoA.id);
        const nextId = yield* vOps.getNextVideoId(fetchedA);
        expect(nextId).toBe(videoB.id);

        // Previous from first video of section 2 → last video of section 1
        const fetchedB = yield* vOps.getVideoWithClipsById(videoB.id);
        const prevId = yield* vOps.getPreviousVideoId(fetchedB);
        expect(prevId).toBe(videoA.id);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns null for next at last video in course", () =>
      Effect.gen(function* () {
        const vOps = yield* VideoOperationsService;
        const fixture = yield* Effect.promise(() =>
          buildCourseFixture([
            {
              path: "section-01",
              order: 1,
              lessons: [
                {
                  path: "lesson-01",
                  title: "Lesson 1",
                  order: 1,
                  videos: [{ path: "a.mp4" }],
                },
              ],
            },
          ])
        );

        const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
        const fetched = yield* vOps.getVideoWithClipsById(videoA.id);

        const nextId = yield* vOps.getNextVideoId(fetched);
        expect(nextId).toBeNull();
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns null for previous at first video in course", () =>
      Effect.gen(function* () {
        const vOps = yield* VideoOperationsService;
        const fixture = yield* Effect.promise(() =>
          buildCourseFixture([
            {
              path: "section-01",
              order: 1,
              lessons: [
                {
                  path: "lesson-01",
                  title: "Lesson 1",
                  order: 1,
                  videos: [{ path: "a.mp4" }],
                },
              ],
            },
          ])
        );

        const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
        const fetched = yield* vOps.getVideoWithClipsById(videoA.id);

        const prevId = yield* vOps.getPreviousVideoId(fetched);
        expect(prevId).toBeNull();
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("skips archived videos in next lesson", () =>
      Effect.gen(function* () {
        const vOps = yield* VideoOperationsService;
        const fixture = yield* Effect.promise(() =>
          buildCourseFixture([
            {
              path: "section-01",
              order: 1,
              lessons: [
                {
                  path: "lesson-01",
                  title: "Lesson 1",
                  order: 1,
                  videos: [{ path: "a.mp4" }],
                },
                {
                  path: "lesson-02",
                  title: "Lesson 2 (all archived)",
                  order: 2,
                  videos: [{ path: "b.mp4", archived: true }],
                },
                {
                  path: "lesson-03",
                  title: "Lesson 3",
                  order: 3,
                  videos: [{ path: "c.mp4" }],
                },
              ],
            },
          ])
        );

        const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
        const videoC = fixture.videos.find((v) => v.path === "c.mp4")!;
        const fetched = yield* vOps.getVideoWithClipsById(videoA.id);

        const nextId = yield* vOps.getNextVideoId(fetched);
        expect(nextId).toBe(videoC.id);
      }).pipe(Effect.provide(testLayer))
    );
  });
});

describe("getNextLessonWithoutVideo", () => {
  it.effect("returns null for standalone video (no lesson)", () =>
    Effect.gen(function* () {
      const vOps = yield* VideoOperationsService;
      const video = yield* vOps.createStandaloneVideo({
        path: "standalone.mp4",
      });
      const fetched = yield* vOps.getVideoWithClipsById(video.id);

      const result = yield* vOps.getNextLessonWithoutVideo(fetched);
      expect(result).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns next lesson in same section that has no videos", () =>
    Effect.gen(function* () {
      const vOps = yield* VideoOperationsService;
      const fixture = yield* Effect.promise(() =>
        buildCourseFixture([
          {
            path: "section-01",
            order: 1,
            lessons: [
              {
                path: "lesson-01",
                title: "Lesson 1",
                order: 1,
                videos: [{ path: "a.mp4" }],
              },
              {
                path: "lesson-02",
                title: "Lesson 2 (empty)",
                order: 2,
                videos: [],
              },
            ],
          },
        ])
      );

      const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
      const fetched = yield* vOps.getVideoWithClipsById(videoA.id);

      const result = yield* vOps.getNextLessonWithoutVideo(fetched);
      expect(result).not.toBeNull();
      expect(result!.lessonPath).toBe("lesson-02");
      expect(result!.sectionPath).toBe("section-01");
      expect(result!.repoFilePath).toBe("/tmp/test-repo");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns null when all subsequent lessons have videos", () =>
    Effect.gen(function* () {
      const vOps = yield* VideoOperationsService;
      const fixture = yield* Effect.promise(() =>
        buildCourseFixture([
          {
            path: "section-01",
            order: 1,
            lessons: [
              {
                path: "lesson-01",
                title: "Lesson 1",
                order: 1,
                videos: [{ path: "a.mp4" }],
              },
              {
                path: "lesson-02",
                title: "Lesson 2",
                order: 2,
                videos: [{ path: "b.mp4" }],
              },
            ],
          },
        ])
      );

      const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
      const fetched = yield* vOps.getVideoWithClipsById(videoA.id);

      const result = yield* vOps.getNextLessonWithoutVideo(fetched);
      expect(result).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("finds empty lesson in a subsequent section", () =>
    Effect.gen(function* () {
      const vOps = yield* VideoOperationsService;
      const fixture = yield* Effect.promise(() =>
        buildCourseFixture([
          {
            path: "section-01",
            order: 1,
            lessons: [
              {
                path: "lesson-01",
                title: "Lesson 1",
                order: 1,
                videos: [{ path: "a.mp4" }],
              },
            ],
          },
          {
            path: "section-02",
            order: 2,
            lessons: [
              {
                path: "lesson-02",
                title: "Lesson 2",
                order: 1,
                videos: [{ path: "b.mp4" }],
              },
              {
                path: "lesson-03",
                title: "Lesson 3 (empty)",
                order: 2,
                videos: [],
              },
            ],
          },
        ])
      );

      const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
      const fetched = yield* vOps.getVideoWithClipsById(videoA.id);

      const result = yield* vOps.getNextLessonWithoutVideo(fetched);
      expect(result).not.toBeNull();
      expect(result!.lessonPath).toBe("lesson-03");
      expect(result!.sectionPath).toBe("section-02");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "returns null when current video is in the last lesson and it has videos",
    () =>
      Effect.gen(function* () {
        const vOps = yield* VideoOperationsService;
        const fixture = yield* Effect.promise(() =>
          buildCourseFixture([
            {
              path: "section-01",
              order: 1,
              lessons: [
                {
                  path: "lesson-01",
                  title: "Lesson 1",
                  order: 1,
                  videos: [{ path: "a.mp4" }],
                },
              ],
            },
          ])
        );

        const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
        const fetched = yield* vOps.getVideoWithClipsById(videoA.id);

        const result = yield* vOps.getNextLessonWithoutVideo(fetched);
        expect(result).toBeNull();
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("skips lessons with videos to find first empty one", () =>
    Effect.gen(function* () {
      const vOps = yield* VideoOperationsService;
      const fixture = yield* Effect.promise(() =>
        buildCourseFixture([
          {
            path: "section-01",
            order: 1,
            lessons: [
              {
                path: "lesson-01",
                title: "Lesson 1",
                order: 1,
                videos: [{ path: "a.mp4" }],
              },
              {
                path: "lesson-02",
                title: "Lesson 2",
                order: 2,
                videos: [{ path: "b.mp4" }],
              },
              {
                path: "lesson-03",
                title: "Lesson 3 (empty)",
                order: 3,
                videos: [],
              },
            ],
          },
        ])
      );

      const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
      const fetched = yield* vOps.getVideoWithClipsById(videoA.id);

      const result = yield* vOps.getNextLessonWithoutVideo(fetched);
      expect(result).not.toBeNull();
      expect(result!.lessonPath).toBe("lesson-03");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("treats lesson with only archived videos as having no videos", () =>
    Effect.gen(function* () {
      const vOps = yield* VideoOperationsService;
      const fixture = yield* Effect.promise(() =>
        buildCourseFixture([
          {
            path: "section-01",
            order: 1,
            lessons: [
              {
                path: "lesson-01",
                title: "Lesson 1",
                order: 1,
                videos: [{ path: "a.mp4" }],
              },
              {
                path: "lesson-02",
                title: "Lesson 2 (all archived)",
                order: 2,
                videos: [{ path: "b.mp4", archived: true }],
              },
            ],
          },
        ])
      );

      const videoA = fixture.videos.find((v) => v.path === "a.mp4")!;
      const fetched = yield* vOps.getVideoWithClipsById(videoA.id);

      const result = yield* vOps.getNextLessonWithoutVideo(fetched);
      expect(result).not.toBeNull();
      expect(result!.lessonPath).toBe("lesson-02");
      expect(result!.sectionPath).toBe("section-01");
    }).pipe(Effect.provide(testLayer))
  );
});
