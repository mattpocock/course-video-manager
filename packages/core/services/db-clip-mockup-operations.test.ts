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

/** The measured speech a caller hands over; the service never makes one. */
const speech = (audioPath: string, durationSeconds: number) => ({
  audioPath,
  durationSeconds,
});

describe("createClipMockup", () => {
  it.effect("appends to the end, carrying the measured speech", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const ops = yield* ClipMockupOperationsService;

      const first = yield* ops.createClipMockup(
        "video-1",
        "Here's the problem.",
        "a.png",
        speech("a.wav", 2.75)
      );
      const second = yield* ops.createClipMockup(
        "video-1",
        "And here's the fix.",
        "b.png",
        speech("b.wav", 1.5)
      );

      expect(first.line).toBe("Here's the problem.");
      expect(first.imagePath).toBe("a.png");
      expect(first.audioPath).toBe("a.wav");
      // A float, never rounded: an Animatic's run time is the sum of these.
      expect(first.durationSeconds).toBe(2.75);
      expect(first.archived).toBe(false);

      const rows = yield* ops.listClipMockupsByVideoId("video-1");
      expect(rows.map((r) => r.id)).toEqual([first.id, second.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("anchors before an existing Clip Mockup", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const ops = yield* ClipMockupOperationsService;

      const first = yield* ops.createClipMockup(
        "video-1",
        "One",
        "a.png",
        speech("a.wav", 1)
      );
      const last = yield* ops.createClipMockup(
        "video-1",
        "Three",
        "c.png",
        speech("c.wav", 1)
      );
      const middle = yield* ops.createClipMockup(
        "video-1",
        "Two",
        "b.png",
        speech("b.wav", 1),
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
        .createClipMockup("video-1", "One", "a.png", speech("a.wav", 1), "nope")
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

      const kept = yield* ops.createClipMockup(
        "video-1",
        "Mine",
        "a.png",
        speech("a.wav", 1)
      );
      const gone = yield* ops.createClipMockup(
        "video-1",
        "Deleted",
        "b.png",
        speech("b.wav", 1)
      );
      yield* ops.createClipMockup(
        "video-2",
        "Theirs",
        "c.png",
        speech("c.wav", 1)
      );
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

describe("setClipMockupLine", () => {
  it.effect("replaces the words and their speech in one write", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const ops = yield* ClipMockupOperationsService;

      const row = yield* ops.createClipMockup(
        "video-1",
        "Too long by half.",
        "a.png",
        speech("old.wav", 4.25)
      );

      const updated = yield* ops.setClipMockupLine(
        row.id,
        "Shorter.",
        speech("new.wav", 1.125)
      );

      expect(updated.line).toBe("Shorter.");
      expect(updated.audioPath).toBe("new.wav");
      expect(updated.durationSeconds).toBe(1.125);
      // The picture is untouched: only the words and their voicing moved.
      expect(updated.imagePath).toBe("a.png");
    }).pipe(Effect.provide(testLayer))
  );
});
