import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach, vi } from "vitest";
import { Effect, Layer, ConfigProvider } from "effect";
import { FileSystem } from "@effect/platform";
import { VideoPostOperationsService } from "@/services/db-video-post-operations.server";
import { BufferApiService } from "@/services/buffer-api-service.server";
import { ObjectStoreService } from "@/services/object-store-service.server";
import { bufferPostProgram } from "@/services/buffer-posting-orchestration.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

const UPLOADED_URL =
  "https://cvm-bucket.s3.eu-west-2.amazonaws.com/cvm/buffer-posts/test.mp4";

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

function makeFakeObjectStore() {
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
            url: UPLOADED_URL,
          };
        })
    ),
  };
}

function makeFakeBufferApi(opts?: { createPostId?: string }) {
  return {
    createPost: vi.fn(
      (_opts: { channelId: string; text: string; videoUrl: string }) =>
        Effect.succeed({ id: opts?.createPostId ?? "buffer-post-123" })
    ),
  };
}

function makeFakeFileSystem(opts?: { fileExists?: boolean }) {
  return FileSystem.FileSystem.of({
    exists: (_path: string) => Effect.succeed(opts?.fileExists ?? true),
  } as any);
}

function makeTestLayer(fakes: {
  objectStore: ReturnType<typeof makeFakeObjectStore>;
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

  const objectStoreLayer = Layer.succeed(
    ObjectStoreService,
    fakes.objectStore as unknown as ObjectStoreService
  );

  const bufferApiLayer = Layer.succeed(
    BufferApiService,
    fakes.bufferApi as unknown as BufferApiService
  );

  return Layer.mergeAll(
    videoPostLayer,
    configLayer,
    fsLayer,
    objectStoreLayer,
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
  describe("happy path — submitted to Buffer", () => {
    it.effect("uploads object, creates post, marks posted immediately", () =>
      Effect.gen(function* () {
        const video = yield* Effect.promise(() => createTestVideo());
        const objectStore = makeFakeObjectStore();
        const bufferApi = makeFakeBufferApi();
        const { sendEvent, events } = makeSendEvent();

        const layer = makeTestLayer({ objectStore, bufferApi });

        yield* bufferPostProgram({
          videoId: video.id,
          caption: "Check this out! #coding",
          sendEvent,
        }).pipe(Effect.provide(layer));

        expect(objectStore.upload).toHaveBeenCalledOnce();
        expect(objectStore.upload.mock.calls[0]![0]).toMatchObject({
          pathname: `cvm/buffer-posts/${video.id}.mp4`,
        });

        expect(bufferApi.createPost).toHaveBeenCalledWith({
          channelId: "channel-abc",
          text: "Check this out! #coding",
          videoUrl: UPLOADED_URL,
        });

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
        expect(eventTypes).toContain("complete");
        expect(eventTypes).not.toContain("polling");
        expect(eventTypes).not.toContain("cleaning-up");
        expect(eventTypes).not.toContain("error");
      })
    );
  });

  describe("createPost fails", () => {
    it.effect("does not mark posted", () =>
      Effect.gen(function* () {
        const video = yield* Effect.promise(() => createTestVideo());
        const objectStore = makeFakeObjectStore();
        const bufferApi = makeFakeBufferApi();
        bufferApi.createPost.mockImplementation(
          () =>
            Effect.fail({
              _tag: "BufferApiError" as const,
              message: "createPost failed",
            }) as any
        );
        const { sendEvent } = makeSendEvent();

        const layer = makeTestLayer({ objectStore, bufferApi });

        const exit = yield* bufferPostProgram({
          videoId: video.id,
          caption: "Fail test",
          sendEvent,
        }).pipe(Effect.provide(layer), Effect.exit);

        expect(exit._tag).toBe("Failure");

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
        const objectStore = makeFakeObjectStore();
        const bufferApi = makeFakeBufferApi();
        const { sendEvent, events } = makeSendEvent();

        const layer = makeTestLayer({
          objectStore,
          bufferApi,
          fileExists: false,
        });

        yield* bufferPostProgram({
          videoId: video.id,
          caption: "No file",
          sendEvent,
        }).pipe(Effect.provide(layer));

        expect(objectStore.upload).not.toHaveBeenCalled();
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
          const objectStore = makeFakeObjectStore();
          const bufferApi = makeFakeBufferApi({ createPostId: "bp-custom-id" });
          const { sendEvent } = makeSendEvent();

          const layer = makeTestLayer({ objectStore, bufferApi });

          yield* bufferPostProgram({
            videoId: video.id,
            caption: "Lifecycle test",
            sendEvent,
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
