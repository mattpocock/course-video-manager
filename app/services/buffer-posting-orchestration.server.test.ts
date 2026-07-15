import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach, vi } from "vitest";
import { Effect, Layer, ConfigProvider } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { BufferApiService } from "@/services/buffer-api-service.server";
import { VercelBlobService } from "@/services/vercel-blob-service.server";
import { bufferPostProgram } from "@/services/buffer-posting-orchestration.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import type { BufferPostStatus } from "@/services/buffer-api-service.server";

let testDb: TestDb;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;
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

function makeFakeBlobService(opts?: { delShouldFail?: boolean }) {
  return {
    upload: vi.fn(
      (_opts: {
        pathname: string;
        filePath: string;
        onProgress?: (p: number) => void;
      }) =>
        Effect.sync(() => {
          _opts.onProgress?.(0);
          _opts.onProgress?.(100);
          return {
            url: "https://blob.vercel-storage.com/buffer-posts/test.mp4",
          };
        })
    ),
    del: vi.fn((_url: string) =>
      opts?.delShouldFail
        ? Effect.fail({
            _tag: "VercelBlobError" as const,
            message: "delete failed",
          })
        : Effect.void
    ),
  };
}

function makeFakeBufferApi(opts?: {
  statusSequence?: BufferPostStatus[];
  createPostId?: string;
}) {
  const statusSequence = opts?.statusSequence ?? ["sent"];
  let pollIndex = 0;

  return {
    createPost: vi.fn(
      (_opts: { channelId: string; text: string; videoUrl: string }) =>
        Effect.succeed({ id: opts?.createPostId ?? "buffer-post-123" })
    ),
    getPostStatus: vi.fn((_postId: string) => {
      const status =
        statusSequence[Math.min(pollIndex, statusSequence.length - 1)]!;
      pollIndex++;
      return Effect.succeed({ status });
    }),
  };
}

function makeFakeFileSystem(opts?: { fileExists?: boolean }) {
  return FileSystem.FileSystem.of({
    exists: (_path: string) => Effect.succeed(opts?.fileExists ?? true),
  } as any);
}

function makeTestLayer(fakes: {
  blobService: ReturnType<typeof makeFakeBlobService>;
  bufferApi: ReturnType<typeof makeFakeBufferApi>;
  fileExists?: boolean;
}) {
  const videoPostLayer = VideoPostOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );

  const configLayer = Layer.setConfigProvider(
    ConfigProvider.fromMap(
      new Map([
        ["FINISHED_VIDEOS_DIRECTORY", "/tmp/finished-videos"],
        ["BUFFER_CHANNEL_ID", "channel-abc"],
      ])
    )
  );

  const fsLayer = Layer.succeed(
    FileSystem.FileSystem,
    makeFakeFileSystem({ fileExists: fakes.fileExists })
  );

  const blobLayer = Layer.succeed(
    VercelBlobService,
    fakes.blobService as unknown as VercelBlobService
  );

  const bufferApiLayer = Layer.succeed(
    BufferApiService,
    fakes.bufferApi as unknown as BufferApiService
  );

  return Layer.mergeAll(
    videoPostLayer,
    configLayer,
    fsLayer,
    blobLayer,
    bufferApiLayer
  );
}

function makeSendEvent() {
  const events: Array<{ event: string; data: unknown }> = [];
  const sendEvent = (event: string, data: unknown) => {
    events.push({ event, data });
  };
  return { sendEvent, events };
}

describe("bufferPostProgram", () => {
  describe("happy path — post reaches sent", () => {
    it.effect(
      "uploads blob, creates post, polls, deletes blob, writes videoPosts row",
      () =>
        Effect.gen(function* () {
          const video = yield* Effect.promise(() => createTestVideo());
          const blobService = makeFakeBlobService();
          const bufferApi = makeFakeBufferApi({ statusSequence: ["sent"] });
          const { sendEvent, events } = makeSendEvent();

          const layer = makeTestLayer({ blobService, bufferApi });

          yield* bufferPostProgram({
            videoId: video.id,
            caption: "Check this out! #coding",
            sendEvent,
            pollIntervalMs: 0,
          }).pipe(Effect.provide(layer));

          expect(blobService.upload).toHaveBeenCalledOnce();
          expect(blobService.upload.mock.calls[0]![0]).toMatchObject({
            pathname: `buffer-posts/${video.id}.mp4`,
          });

          expect(bufferApi.createPost).toHaveBeenCalledWith({
            channelId: "channel-abc",
            text: "Check this out! #coding",
            videoUrl: "https://blob.vercel-storage.com/buffer-posts/test.mp4",
          });

          expect(bufferApi.getPostStatus).toHaveBeenCalledWith(
            "buffer-post-123"
          );

          expect(blobService.del).toHaveBeenCalledWith(
            "https://blob.vercel-storage.com/buffer-posts/test.mp4"
          );

          const posts = yield* Effect.promise(() =>
            testDb.query.videoPosts.findMany({
              where: eq(schema.videoPosts.videoId, video.id),
            })
          );
          expect(posts).toHaveLength(1);
          expect(posts[0]!.platform).toBe("buffer");
          expect(posts[0]!.remoteId).toBe("buffer-post-123");
          expect(posts[0]!.postedAt).toBeInstanceOf(Date);

          const eventTypes = events.map((e) => e.event);
          expect(eventTypes).toContain("uploading-blob");
          expect(eventTypes).toContain("creating-post");
          expect(eventTypes).toContain("polling");
          expect(eventTypes).toContain("cleaning-up");
          expect(eventTypes).toContain("complete");
          expect(eventTypes).not.toContain("error");
        })
    );
  });

  describe("poll retries before reaching sent", () => {
    it.effect("polls multiple times until sent", () =>
      Effect.gen(function* () {
        const video = yield* Effect.promise(() => createTestVideo());
        const bufferApi = makeFakeBufferApi({
          statusSequence: ["buffer", "buffer", "sent"],
        });
        const blobService = makeFakeBlobService();
        const { sendEvent, events } = makeSendEvent();

        const layer = makeTestLayer({ blobService, bufferApi });

        yield* bufferPostProgram({
          videoId: video.id,
          caption: "Poll test",
          sendEvent,
          pollIntervalMs: 0,
        }).pipe(Effect.provide(layer));

        expect(bufferApi.getPostStatus).toHaveBeenCalledTimes(3);

        expect(blobService.del).toHaveBeenCalledOnce();

        const pollingEvents = events.filter((e) => e.event === "polling");
        expect(pollingEvents).toHaveLength(4); // initial + 3 polls
      })
    );
  });

  describe("post reaches error status", () => {
    it.effect("keeps blob and sends error event", () =>
      Effect.gen(function* () {
        const video = yield* Effect.promise(() => createTestVideo());
        const bufferApi = makeFakeBufferApi({
          statusSequence: ["buffer", "error"],
        });
        const blobService = makeFakeBlobService();
        const { sendEvent, events } = makeSendEvent();

        const layer = makeTestLayer({ blobService, bufferApi });

        yield* bufferPostProgram({
          videoId: video.id,
          caption: "Error test",
          sendEvent,
          pollIntervalMs: 0,
        }).pipe(Effect.provide(layer));

        expect(blobService.del).not.toHaveBeenCalled();

        const errorEvents = events.filter((e) => e.event === "error");
        expect(errorEvents).toHaveLength(1);
        expect((errorEvents[0]!.data as any).message).toContain(
          "error posting"
        );

        expect(events.map((e) => e.event)).not.toContain("complete");

        const posts = yield* Effect.promise(() =>
          testDb.query.videoPosts.findMany({
            where: eq(schema.videoPosts.videoId, video.id),
          })
        );
        expect(posts).toHaveLength(1);
        expect(posts[0]!.postedAt).toBeNull();
      })
    );
  });

  describe("file does not exist", () => {
    it.effect("sends error and does not upload", () =>
      Effect.gen(function* () {
        const video = yield* Effect.promise(() => createTestVideo());
        const blobService = makeFakeBlobService();
        const bufferApi = makeFakeBufferApi();
        const { sendEvent, events } = makeSendEvent();

        const layer = makeTestLayer({
          blobService,
          bufferApi,
          fileExists: false,
        });

        yield* bufferPostProgram({
          videoId: video.id,
          caption: "No file",
          sendEvent,
          pollIntervalMs: 0,
        }).pipe(Effect.provide(layer));

        expect(blobService.upload).not.toHaveBeenCalled();
        expect(bufferApi.createPost).not.toHaveBeenCalled();

        const errorEvents = events.filter((e) => e.event === "error");
        expect(errorEvents).toHaveLength(1);
        expect((errorEvents[0]!.data as any).message).toContain("not found");
      })
    );
  });

  describe("videoPosts row lifecycle", () => {
    it.effect(
      "creates row before upload and sets remoteId after createPost",
      () =>
        Effect.gen(function* () {
          const video = yield* Effect.promise(() => createTestVideo());
          const blobService = makeFakeBlobService();
          const bufferApi = makeFakeBufferApi({
            createPostId: "bp-custom-id",
            statusSequence: ["sent"],
          });
          const { sendEvent } = makeSendEvent();

          const layer = makeTestLayer({ blobService, bufferApi });

          yield* bufferPostProgram({
            videoId: video.id,
            caption: "Lifecycle test",
            sendEvent,
            pollIntervalMs: 0,
          }).pipe(Effect.provide(layer));

          const posts = yield* Effect.promise(() =>
            testDb.query.videoPosts.findMany({
              where: eq(schema.videoPosts.videoId, video.id),
            })
          );
          expect(posts[0]!.remoteId).toBe("bp-custom-id");
          expect(posts[0]!.remoteUrl).toBeNull();
          expect(posts[0]!.postedAt).toBeInstanceOf(Date);
        })
    );
  });
});
