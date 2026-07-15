import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let testLayer: Layer.Layer<VideoPostOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = VideoPostOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

async function createTestVideo(title = "Test Short") {
  const [video] = await testDb
    .insert(schema.videos)
    .values({
      title,
      originalFootagePath: "",
      format: "short",
    })
    .returning();
  return video!;
}

describe("createVideoPost", () => {
  it.effect("creates a video post with platform and videoId", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(() => createTestVideo());
      const ops = yield* VideoPostOperationsService;
      const post = yield* ops.createVideoPost({
        videoId: video.id,
        platform: "youtube-shorts",
      });

      expect(post.id).toEqual(expect.any(String));
      expect(post.videoId).toBe(video.id);
      expect(post.platform).toBe("youtube-shorts");
      expect(post.remoteId).toBeNull();
      expect(post.remoteUrl).toBeNull();
      expect(post.postedAt).toBeNull();
      expect(post.createdAt).toBeInstanceOf(Date);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows multiple posts for the same video", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(() => createTestVideo());
      const ops = yield* VideoPostOperationsService;

      const post1 = yield* ops.createVideoPost({
        videoId: video.id,
        platform: "youtube-shorts",
      });
      const post2 = yield* ops.createVideoPost({
        videoId: video.id,
        platform: "buffer",
      });

      expect(post1.id).not.toBe(post2.id);
      expect(post1.platform).toBe("youtube-shorts");
      expect(post2.platform).toBe("buffer");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("listByVideoId", () => {
  it.effect("returns all posts for a video", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(() => createTestVideo());
      const ops = yield* VideoPostOperationsService;

      yield* ops.createVideoPost({
        videoId: video.id,
        platform: "youtube-shorts",
      });
      yield* ops.createVideoPost({
        videoId: video.id,
        platform: "buffer",
      });

      const posts = yield* ops.listByVideoId(video.id);
      expect(posts).toHaveLength(2);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns empty array when no posts exist", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(() => createTestVideo());
      const ops = yield* VideoPostOperationsService;

      const posts = yield* ops.listByVideoId(video.id);
      expect(posts).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("does not return posts from other videos", () =>
    Effect.gen(function* () {
      const video1 = yield* Effect.promise(() => createTestVideo("Short 1"));
      const video2 = yield* Effect.promise(() => createTestVideo("Short 2"));
      const ops = yield* VideoPostOperationsService;

      yield* ops.createVideoPost({
        videoId: video1.id,
        platform: "youtube-shorts",
      });
      yield* ops.createVideoPost({
        videoId: video2.id,
        platform: "buffer",
      });

      const posts = yield* ops.listByVideoId(video1.id);
      expect(posts).toHaveLength(1);
      expect(posts[0]!.platform).toBe("youtube-shorts");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("updateRemoteInfo", () => {
  it.effect("sets remoteId and remoteUrl on a post", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(() => createTestVideo());
      const ops = yield* VideoPostOperationsService;

      const post = yield* ops.createVideoPost({
        videoId: video.id,
        platform: "youtube-shorts",
      });

      const updated = yield* ops.updateRemoteInfo({
        id: post.id,
        remoteId: "yt-abc123",
        remoteUrl: "https://youtube.com/shorts/abc123",
      });

      expect(updated.remoteId).toBe("yt-abc123");
      expect(updated.remoteUrl).toBe("https://youtube.com/shorts/abc123");
      expect(updated.postedAt).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );
});

describe("markPosted", () => {
  it.effect("sets postedAt timestamp on a post", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(() => createTestVideo());
      const ops = yield* VideoPostOperationsService;

      const post = yield* ops.createVideoPost({
        videoId: video.id,
        platform: "youtube-shorts",
      });

      const marked = yield* ops.markPosted(post.id);
      expect(marked.postedAt).toBeInstanceOf(Date);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("cascade delete", () => {
  it.effect("deletes video posts when parent video is deleted", () =>
    Effect.gen(function* () {
      const video = yield* Effect.promise(() => createTestVideo());
      const ops = yield* VideoPostOperationsService;

      yield* ops.createVideoPost({
        videoId: video.id,
        platform: "youtube-shorts",
      });

      yield* Effect.promise(() =>
        testDb.delete(schema.videos).where(eq(schema.videos.id, video.id))
      );

      const posts = yield* ops.listByVideoId(video.id);
      expect(posts).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );
});
