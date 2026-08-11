import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VideoOperationsService } from "./db-video-operations.server.js";
import { CourseOperationsService } from "./db-course-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import * as schema from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

let testDb: TestDb;
let testLayer: Layer.Layer<VideoOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);

  testLayer = VideoOperationsService.Default.pipe(
    Layer.provide(CourseOperationsService.Default),
    Layer.provide(drizzleLayer)
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

describe("unlinkVideoFromPitch", () => {
  it.effect("nulls pitchId and returns the updated video row", () =>
    Effect.gen(function* () {
      const [pitch] = yield* Effect.promise(() =>
        testDb.insert(schema.pitches).values({ title: "My Pitch" }).returning()
      );

      const [video] = yield* Effect.promise(() =>
        testDb
          .insert(schema.videos)
          .values({
            title: "test-vid",
            originalFootagePath: "",
            pitchId: pitch!.id,
          })
          .returning()
      );

      const videoOps = yield* VideoOperationsService;
      const updated = yield* videoOps.unlinkVideoFromPitch(video!.id);

      expect(updated.id).toBe(video!.id);
      expect(updated.title).toBe("test-vid");
      expect(updated.pitchId).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for non-existent video", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const result = yield* videoOps
        .unlinkVideoFromPitch("nonexistent-id")
        .pipe(Effect.flip);

      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );
});
