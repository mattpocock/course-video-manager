import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { ConfigProvider, Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { VideoProcessingService } from "@/services/video-processing-service";
import { FFmpegCommandsService } from "@/services/ffmpeg-commands";
import { DrizzleService } from "@/services/drizzle-service.server";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import {
  buildSubtitles,
  RenderVerticalVideoService,
} from "./render-vertical-video-service";

describe("buildSubtitles", () => {
  it("keeps a short segment as a single subtitle and converts to frames", () => {
    // "Hello world" is 11 chars (<= 32), so it passes through untouched.
    const segments = [{ start: 0, end: 1, text: "Hello world" }];

    const result = buildSubtitles(segments, 60);

    expect(result).toEqual([
      { startFrame: 0, endFrame: 60, text: "Hello world" },
    ]);
  });

  it("splits a long segment into phrases with evenly divided timing", () => {
    // 43 chars > 32 → numChunks = ceil(43/32) = 2; 9 words →
    // wordsPerChunk = ceil(9/2) = 5. Duration 10s / 2 = 5s per chunk.
    const segments = [
      {
        start: 0,
        end: 10,
        text: "The quick brown fox jumps over the lazy dog",
      },
    ];

    const result = buildSubtitles(segments, 1);

    expect(result).toEqual([
      { startFrame: 0, endFrame: 5, text: "The quick brown fox jumps" },
      { startFrame: 5, endFrame: 10, text: "over the lazy dog" },
    ]);
  });

  it("flattens multiple segments and trims Whisper's leading spaces", () => {
    // Whisper segment text is typically prefixed with a space; floor() is used
    // for the seconds → frames conversion.
    const segments = [
      { start: 0, end: 0.9, text: " Hi there" },
      { start: 1, end: 2, text: " again" },
    ];

    const result = buildSubtitles(segments, 1);

    expect(result).toEqual([
      { startFrame: 0, endFrame: 0, text: "Hi there" },
      { startFrame: 1, endFrame: 2, text: "again" },
    ]);
  });

  it("returns an empty array when there are no segments", () => {
    expect(buildSubtitles([], 60)).toEqual([]);
  });
});

describe("RenderVerticalVideoService", () => {
  let testDb: TestDb;

  beforeAll(async () => {
    const result = await createTestDb();
    testDb = result.testDb;
  });

  beforeEach(async () => {
    await truncateAllTables(testDb);
  });

  function buildTestLayer(overrides?: {
    exportResult?: string;
    getFpsResult?: number;
  }) {
    const dbLayer = Layer.succeed(DrizzleService, testDb as any);

    const fakeVideoProcessing = Layer.succeed(VideoProcessingService, {
      transcribeVideoFile: () =>
        Effect.succeed({
          words: [
            { start: 0, end: 0.5, text: "hello" },
            { start: 0.6, end: 1.0, text: "world" },
          ],
          segments: [{ start: 0, end: 1.0, text: "hello world" }],
        }),
      exportVideoClips: () =>
        Effect.succeed(overrides?.exportResult ?? "/tmp/fake-concatenated.mp4"),
    } as any);

    const fakeFfmpeg = Layer.succeed(FFmpegCommandsService, {
      getFPS: () => Effect.succeed(overrides?.getFpsResult ?? 60),
    } as any);

    const configLayer = Layer.setConfigProvider(
      ConfigProvider.fromMap(
        new Map([
          ["FINISHED_VIDEOS_DIRECTORY", "/tmp/test-finished-videos"],
          ["OPENAI_API_KEY", "test-key"],
        ])
      )
    );

    const depsLayer = Layer.mergeAll(
      VideoOperationsService.Default.pipe(Layer.provide(dbLayer)),
      ClipOperationsService.Default.pipe(Layer.provide(dbLayer)),
      fakeVideoProcessing,
      fakeFfmpeg,
      configLayer,
      NodeContext.layer
    );

    return Layer.merge(
      depsLayer,
      RenderVerticalVideoService.Default.pipe(Layer.provide(depsLayer))
    );
  }

  it.effect("rejects when video has no clips", () =>
    Effect.gen(function* () {
      const [video] = yield* Effect.promise(() =>
        testDb
          .insert(schema.videos)
          .values({
            title: "Empty Short",
            originalFootagePath: "/footage/empty.mp4",
            format: "short",
          })
          .returning()
      );

      const service = yield* RenderVerticalVideoService;
      const result = yield* service
        .renderVerticalVideo({ videoId: video!.id })
        .pipe(Effect.flip);

      expect(result._tag).toBe("RenderVerticalError");
    }).pipe(Effect.provide(buildTestLayer()))
  );

  it.effect("rejects when video does not exist", () =>
    Effect.gen(function* () {
      const service = yield* RenderVerticalVideoService;
      const result = yield* service
        .renderVerticalVideo({ videoId: "nonexistent-id" })
        .pipe(Effect.flip);

      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(buildTestLayer()))
  );
});
