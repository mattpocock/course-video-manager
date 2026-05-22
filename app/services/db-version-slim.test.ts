import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import * as schema from "@/db/schema";

let testDb: TestDb;
let testLayer: Layer.Layer<VersionOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = VersionOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const buildFixture = () =>
  Effect.gen(function* () {
    const [course] = yield* Effect.promise(() =>
      testDb
        .insert(schema.courses)
        .values({ name: "Test Course", filePath: "/tmp/test" })
        .returning()
    );

    const [version] = yield* Effect.promise(() =>
      testDb
        .insert(schema.courseVersions)
        .values({ repoId: course!.id, name: "v1" })
        .returning()
    );

    const [section] = yield* Effect.promise(() =>
      testDb
        .insert(schema.sections)
        .values({ repoVersionId: version!.id, path: "01-intro", order: 1 })
        .returning()
    );

    const [lesson] = yield* Effect.promise(() =>
      testDb
        .insert(schema.lessons)
        .values({
          sectionId: section!.id,
          path: "01-intro/01-lesson",
          order: 1,
          authoringStatus: "done",
        })
        .returning()
    );

    const [video] = yield* Effect.promise(() =>
      testDb
        .insert(schema.videos)
        .values({
          lessonId: lesson!.id,
          path: "01-intro/01-lesson/video",
          originalFootagePath: "footage.mp4",
        })
        .returning()
    );

    return { course: course!, version: version!, video: video! };
  });

describe("getCourseWithSectionsByVersionSlim", () => {
  it.effect("returns only videoFilename from clips, not all clip columns", () =>
    Effect.gen(function* () {
      const { course, version, video } = yield* buildFixture();

      yield* Effect.promise(() =>
        testDb.insert(schema.clips).values({
          videoId: video.id,
          videoFilename: "clip-001.mp4",
          sourceStartTime: 0,
          sourceEndTime: 10,
          order: "1",
          text: "",
        })
      );

      const versionOps = yield* VersionOperationsService;
      const result = yield* versionOps.getCourseWithSectionsByVersionSlim({
        repoId: course.id,
        versionId: version.id,
      });

      expect(result.id).toBe(course.id);
      expect(result.name).toBe("Test Course");
      expect(result.sections).toHaveLength(1);

      const clip = result.sections[0]!.lessons[0]!.videos[0]!.clips[0]!;
      expect(clip.videoFilename).toBe("clip-001.mp4");
      // slim variant should only have id and videoFilename on clips
      expect(Object.keys(clip).sort()).toEqual(["id", "videoFilename"].sort());
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("excludes archived sections", () =>
    Effect.gen(function* () {
      const { course, version } = yield* buildFixture();

      // buildFixture already inserted one active section; add an archived one
      yield* Effect.promise(() =>
        testDb.insert(schema.sections).values({
          repoVersionId: version.id,
          path: "02-archived",
          order: 2,
          archivedAt: new Date(),
        })
      );

      const versionOps = yield* VersionOperationsService;
      const result = yield* versionOps.getCourseWithSectionsByVersionSlim({
        repoId: course.id,
        versionId: version.id,
      });

      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]!.path).toBe("01-intro");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("excludes archived clips", () =>
    Effect.gen(function* () {
      const { course, version, video } = yield* buildFixture();

      yield* Effect.promise(() =>
        testDb.insert(schema.clips).values([
          {
            videoId: video.id,
            videoFilename: "active.mp4",
            sourceStartTime: 0,
            sourceEndTime: 10,
            order: "1",
            text: "",
            archived: false,
          },
          {
            videoId: video.id,
            videoFilename: "archived.mp4",
            sourceStartTime: 10,
            sourceEndTime: 20,
            order: "2",
            text: "",
            archived: true,
          },
        ])
      );

      const versionOps = yield* VersionOperationsService;
      const result = yield* versionOps.getCourseWithSectionsByVersionSlim({
        repoId: course.id,
        versionId: version.id,
      });

      const clips = result.sections[0]!.lessons[0]!.videos[0]!.clips;
      expect(clips).toHaveLength(1);
      expect(clips[0]!.videoFilename).toBe("active.mp4");
    }).pipe(Effect.provide(testLayer))
  );
});
