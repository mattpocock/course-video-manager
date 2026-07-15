import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let testLayer: Layer.Layer<VideoOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  testLayer = VideoOperationsService.Default.pipe(
    Layer.provide(
      CourseOperationsService.Default.pipe(Layer.provide(drizzleLayer))
    ),
    Layer.provide(drizzleLayer)
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

describe("video format", () => {
  it.effect("defaults to standard when not specified", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Test Video",
      });

      expect(video.format).toBe("standard");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("creates a short video with format short", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Short Video",
        format: "short",
      });

      expect(video.format).toBe("short");
      expect(video.lessonId).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("updateVideoFormat sets format and clears lessonId", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        title: "Test Video",
      });

      const updated = yield* videoOps.updateVideoFormat({
        videoId: video.id,
        format: "short",
      });

      expect(updated.format).toBe("short");
      expect(updated.lessonId).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "getAllStandaloneVideos({ format: short }) returns only shorts",
    () =>
      Effect.gen(function* () {
        const videoOps = yield* VideoOperationsService;

        yield* videoOps.createStandaloneVideo({ title: "Standard 1" });
        yield* videoOps.createStandaloneVideo({
          title: "Short 1",
          format: "short",
        });
        yield* videoOps.createStandaloneVideo({ title: "Standard 2" });
        yield* videoOps.createStandaloneVideo({
          title: "Short 2",
          format: "short",
        });

        const shorts = yield* videoOps.getAllStandaloneVideos({
          format: "short",
        });
        expect(shorts).toHaveLength(2);
        expect(shorts.map((v) => v.title).sort()).toEqual([
          "Short 1",
          "Short 2",
        ]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "getAllStandaloneVideos with format filter returns only matching",
    () =>
      Effect.gen(function* () {
        const videoOps = yield* VideoOperationsService;

        yield* videoOps.createStandaloneVideo({ title: "Standard" });
        yield* videoOps.createStandaloneVideo({
          title: "Short",
          format: "short",
        });

        const shorts = yield* videoOps.getAllStandaloneVideos({
          format: "short",
        });
        expect(shorts).toHaveLength(1);
        expect(shorts[0]!.title).toBe("Short");

        const standards = yield* videoOps.getAllStandaloneVideos({
          format: "standard",
        });
        expect(standards).toHaveLength(1);
        expect(standards[0]!.title).toBe("Standard");

        const all = yield* videoOps.getAllStandaloneVideos();
        expect(all).toHaveLength(2);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("format filter excludes archived shorts", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;

      const short = yield* videoOps.createStandaloneVideo({
        title: "Active Short",
        format: "short",
      });
      const archivedShort = yield* videoOps.createStandaloneVideo({
        title: "Archived Short",
        format: "short",
      });
      yield* videoOps.updateVideoArchiveStatus({
        videoId: archivedShort.id,
        archived: true,
      });

      const shorts = yield* videoOps.getAllStandaloneVideos({
        format: "short",
      });
      expect(shorts).toHaveLength(1);
      expect(shorts[0]!.id).toBe(short.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "getArchivedStandaloneVideos with format filter returns only matching",
    () =>
      Effect.gen(function* () {
        const videoOps = yield* VideoOperationsService;

        const archivedStandard = yield* videoOps.createStandaloneVideo({
          title: "Archived Standard",
        });
        const archivedShort = yield* videoOps.createStandaloneVideo({
          title: "Archived Short",
          format: "short",
        });

        yield* videoOps.updateVideoArchiveStatus({
          videoId: archivedStandard.id,
          archived: true,
        });
        yield* videoOps.updateVideoArchiveStatus({
          videoId: archivedShort.id,
          archived: true,
        });

        const standardOnly = yield* videoOps.getArchivedStandaloneVideos({
          format: "standard",
        });
        expect(standardOnly).toHaveLength(1);
        expect(standardOnly[0]!.title).toBe("Archived Standard");

        const shortOnly = yield* videoOps.getArchivedStandaloneVideos({
          format: "short",
        });
        expect(shortOnly).toHaveLength(1);
        expect(shortOnly[0]!.title).toBe("Archived Short");

        const all = yield* videoOps.getArchivedStandaloneVideos();
        expect(all).toHaveLength(2);
      }).pipe(Effect.provide(testLayer))
  );
});
