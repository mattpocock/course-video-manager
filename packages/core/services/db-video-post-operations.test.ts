import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { VideoPostOperationsService } from "./db-video-post-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import * as schema from "../db/schema.js";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/test-db.js";

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

describe("listByVideoIds", () => {
  it.effect("returns the posts of every Video named, and no others", () =>
    Effect.gen(function* () {
      const video1 = yield* Effect.promise(() => createTestVideo("Short 1"));
      const video2 = yield* Effect.promise(() => createTestVideo("Short 2"));
      const video3 = yield* Effect.promise(() => createTestVideo("Short 3"));
      const ops = yield* VideoPostOperationsService;

      yield* ops.createVideoPost({
        videoId: video1.id,
        platform: "youtube-shorts",
      });
      yield* ops.createVideoPost({ videoId: video2.id, platform: "buffer" });
      yield* ops.createVideoPost({ videoId: video3.id, platform: "buffer" });

      const posts = yield* ops.listByVideoIds([video1.id, video2.id]);
      expect(posts.map((p) => `${p.videoId}:${p.platform}`).sort()).toEqual(
        [`${video1.id}:youtube-shorts`, `${video2.id}:buffer`].sort()
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns nothing for no Videos", () =>
    Effect.gen(function* () {
      const ops = yield* VideoPostOperationsService;
      expect(yield* ops.listByVideoIds([])).toEqual([]);
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
