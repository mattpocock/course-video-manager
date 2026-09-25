import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { ClipMockupOperationsService } from "./db-clip-mockup-operations.server.js";
import { DrizzleService } from "./drizzle-service.server.js";
import { videos } from "../db/schema.js";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "../test-utils/pglite.js";

// ===========================================================================
// The row half of a Clip Mockup. The frame half is in apps/local, and so is
// every test of it — this file only asserts what the database is responsible
// for: the ordering, the archive, and the fields a Clip Mockup must carry.
// ===========================================================================

let testDb: TestDb;
let testLayer: Layer.Layer<ClipMockupOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = ClipMockupOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const makeVideo = async (id: string) => {
  await testDb.insert(videos).values({
    id,
    title: `${id}.mp4`,
    originalFootagePath: `/footage/${id}`,
  });
};

describe("createClipMockup", () => {
  it.effect("appends to the end and leaves the duration empty", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const ops = yield* ClipMockupOperationsService;

      const first = yield* ops.createClipMockup(
        "video-1",
        "Here's the problem.",
        "a.png"
      );
      const second = yield* ops.createClipMockup(
        "video-1",
        "And here's the fix.",
        "b.png"
      );

      expect(first.line).toBe("Here's the problem.");
      expect(first.imagePath).toBe("a.png");
      expect(first.durationSeconds).toBeNull();
      expect(first.archived).toBe(false);

      const rows = yield* ops.listClipMockupsByVideoId("video-1");
      expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("anchors before an existing Clip Mockup", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const ops = yield* ClipMockupOperationsService;

      const first = yield* ops.createClipMockup("video-1", "One", "a.png");
      const last = yield* ops.createClipMockup("video-1", "Three", "c.png");
      const middle = yield* ops.createClipMockup(
        "video-1",
        "Two",
        "b.png",
        last.id
      );

      const rows = yield* ops.listClipMockupsByVideoId("video-1");
      expect(rows.map((r) => r.id)).toEqual([first.id, middle.id, last.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("refuses an anchor that is not in the Video", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const ops = yield* ClipMockupOperationsService;

      const failure = yield* ops
        .createClipMockup("video-1", "One", "a.png", "nope")
        .pipe(Effect.flip);

      expect(failure._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("listClipMockupsByVideoId", () => {
  it.effect("excludes archived rows and other Videos' rows", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      yield* Effect.promise(() => makeVideo("video-2"));
      const ops = yield* ClipMockupOperationsService;

      const kept = yield* ops.createClipMockup("video-1", "Mine", "a.png");
      const gone = yield* ops.createClipMockup("video-1", "Deleted", "b.png");
      yield* ops.createClipMockup("video-2", "Theirs", "c.png");
      yield* ops.deleteClipMockup(gone.id);

      const rows = yield* ops.listClipMockupsByVideoId("video-1");
      expect(rows.map((r) => r.id)).toEqual([kept.id]);

      // Archived == deleted, but the row itself survives for `get` to report.
      const archived = yield* ops.getClipMockupById(gone.id);
      expect(archived.archived).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("getClipMockupById", () => {
  it.effect("is a NotFoundError for an unknown id", () =>
    Effect.gen(function* () {
      const ops = yield* ClipMockupOperationsService;
      const failure = yield* ops.getClipMockupById("nope").pipe(Effect.flip);
      expect(failure._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );
});
