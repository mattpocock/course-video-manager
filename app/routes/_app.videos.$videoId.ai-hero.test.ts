import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { NodeContext } from "@effect/platform-node";
import nodeFs from "node:fs";
import path from "node:path";
import { FileSystem } from "@effect/platform";
import { ClipOperationsService } from "@/services/db-clip-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { CourseOperationsService } from "@/services/db-course-operations.server";
import { VersionOperationsService } from "@/services/db-version-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { loadVideoPostingContext } from "@/services/video-posting-context.server";

let testDb: TestDb;
type TestServices =
  | ClipOperationsService
  | VideoOperationsService
  | CourseOperationsService
  | VersionOperationsService
  | LessonSectionOperationsService
  | LinkAuthOperationsService
  | DrizzleService
  | FileSystem.FileSystem;

let testLayer: Layer.Layer<TestServices>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  testLayer = Layer.mergeAll(
    ClipOperationsService.Default,
    VideoOperationsService.Default,
    CourseOperationsService.Default,
    VersionOperationsService.Default,
    LessonSectionOperationsService.Default,
    LinkAuthOperationsService.Default,
    drizzleLayer,
    NodeContext.layer
  ).pipe(Layer.provide(drizzleLayer));
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

function setupStandaloneDir(videoId: string): string {
  const baseDir =
    process.env.STANDALONE_VIDEO_FILES_DIR || "./standalone-video-files";
  const dir = path.join(baseDir, videoId);
  nodeFs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("ai-hero route loader", () => {
  it.effect("returns aiHero connected false when no AI Hero auth exists", () =>
    Effect.gen(function* () {
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.createStandaloneVideo({
        path: "test-video",
      });
      setupStandaloneDir(video.id);

      const ctx = yield* loadVideoPostingContext(video.id);
      const linkAuthOps = yield* LinkAuthOperationsService;
      const aiHeroAuth = yield* linkAuthOps.getAiHeroAuth();
      const aiHero: { connected: true; userId: string } | { connected: false } =
        aiHeroAuth
          ? { connected: true, userId: aiHeroAuth.userId }
          : { connected: false };

      expect(aiHero).toEqual({ connected: false });
      expect(ctx.videoPath).toBe("test-video");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "returns aiHero connected true with userId when AI Hero auth exists",
    () =>
      Effect.gen(function* () {
        const videoOps = yield* VideoOperationsService;
        const video = yield* videoOps.createStandaloneVideo({
          path: "test-video",
        });
        setupStandaloneDir(video.id);

        const linkAuthOps = yield* LinkAuthOperationsService;
        yield* linkAuthOps.upsertAiHeroAuth({
          accessToken: "test-token",
          userId: "user-123",
        });

        const ctx = yield* loadVideoPostingContext(video.id);
        const aiHeroAuth = yield* linkAuthOps.getAiHeroAuth();
        const aiHero:
          | { connected: true; userId: string }
          | { connected: false } = aiHeroAuth
          ? { connected: true, userId: aiHeroAuth.userId }
          : { connected: false };

        expect(aiHero).toEqual({ connected: true, userId: "user-123" });
        expect(ctx.videoPath).toBe("test-video");
      }).pipe(Effect.provide(testLayer))
  );
});
