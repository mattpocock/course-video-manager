import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { SegmentOperationsService } from "@/services/db-segment-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { segments, videos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { compareOrderStrings } from "@/lib/sort-by-order";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let testLayer: Layer.Layer<SegmentOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = SegmentOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const makeVideo = async (id: string) => {
  await testDb.insert(videos).values({
    id,
    path: `${id}.mp4`,
    originalFootagePath: `/footage/${id}`,
  });
};

describe("createSegment", () => {
  it.effect("defaults to the definition kind with an empty title", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;

      const segment = yield* segmentOps.createSegment("video-1");

      expect(segment.kind).toBe("definition");
      expect(segment.title).toBe("");
      expect(segment.description).toBe("");
      expect(segment.videoId).toBe("video-1");
      expect(segment.order).toEqual(expect.any(String));
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("uses the provided kind", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;

      const segment = yield* segmentOps.createSegment("video-1", "quest");

      expect(segment.kind).toBe("quest");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("slots new segments at the end, in creation order", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;

      const first = yield* segmentOps.createSegment("video-1");
      const second = yield* segmentOps.createSegment("video-1");
      const third = yield* segmentOps.createSegment("video-1");

      expect(compareOrderStrings(first.order, second.order)).toBeLessThan(0);
      expect(compareOrderStrings(second.order, third.order)).toBeLessThan(0);

      const listed = yield* segmentOps.listSegmentsByVideoId("video-1");
      expect(listed.map((s) => s.id)).toEqual([first.id, second.id, third.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("stores the provided title", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;

      const segment = yield* segmentOps.createSegment(
        "video-1",
        "quest",
        null,
        "Closures"
      );

      expect(segment.title).toBe("Closures");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "inserts before the anchor segment when given beforeSegmentId",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => makeVideo("video-1"));
        const segmentOps = yield* SegmentOperationsService;

        const first = yield* segmentOps.createSegment("video-1");
        const third = yield* segmentOps.createSegment("video-1");
        // Slot a new segment immediately before `third`.
        const second = yield* segmentOps.createSegment(
          "video-1",
          "quest",
          third.id
        );

        expect(compareOrderStrings(first.order, second.order)).toBeLessThan(0);
        expect(compareOrderStrings(second.order, third.order)).toBeLessThan(0);

        const listed = yield* segmentOps.listSegmentsByVideoId("video-1");
        expect(listed.map((s) => s.id)).toEqual([
          first.id,
          second.id,
          third.id,
        ]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("inserts at the front when the anchor is the first segment", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;

      const first = yield* segmentOps.createSegment("video-1");
      const zeroth = yield* segmentOps.createSegment(
        "video-1",
        "definition",
        first.id
      );

      const listed = yield* segmentOps.listSegmentsByVideoId("video-1");
      expect(listed.map((s) => s.id)).toEqual([zeroth.id, first.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when beforeSegmentId does not exist", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;

      const result = yield* segmentOps
        .createSegment("video-1", "definition", "missing")
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("scopes order to each video independently", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      yield* Effect.promise(() => makeVideo("video-2"));
      const segmentOps = yield* SegmentOperationsService;

      yield* segmentOps.createSegment("video-1");
      yield* segmentOps.createSegment("video-2");

      const v1 = yield* segmentOps.listSegmentsByVideoId("video-1");
      const v2 = yield* segmentOps.listSegmentsByVideoId("video-2");
      expect(v1).toHaveLength(1);
      expect(v2).toHaveLength(1);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("renameSegment", () => {
  it.effect("updates the title", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;
      const created = yield* segmentOps.createSegment("video-1");

      const renamed = yield* segmentOps.renameSegment(created.id, "Closures");

      expect(renamed.title).toBe("Closures");
      expect(renamed.kind).toBe("definition");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when the segment does not exist", () =>
    Effect.gen(function* () {
      const segmentOps = yield* SegmentOperationsService;
      const result = yield* segmentOps
        .renameSegment("missing", "x")
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("setSegmentDescription", () => {
  it.effect("persists the description while preserving title and kind", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;
      const created = yield* segmentOps.createSegment("video-1", "quest");
      yield* segmentOps.renameSegment(created.id, "Closures");

      const updated = yield* segmentOps.setSegmentDescription(
        created.id,
        "Explain the stack vs the heap before the demo."
      );

      expect(updated.description).toBe(
        "Explain the stack vs the heap before the demo."
      );
      expect(updated.title).toBe("Closures");
      expect(updated.kind).toBe("quest");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("can be cleared back to an empty string", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;
      const created = yield* segmentOps.createSegment("video-1");
      yield* segmentOps.setSegmentDescription(created.id, "draft note");

      const cleared = yield* segmentOps.setSegmentDescription(created.id, "");

      expect(cleared.description).toBe("");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when the segment does not exist", () =>
    Effect.gen(function* () {
      const segmentOps = yield* SegmentOperationsService;
      const result = yield* segmentOps
        .setSegmentDescription("missing", "x")
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("setSegmentKind", () => {
  it.effect("changes the kind while preserving the title", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;
      const created = yield* segmentOps.createSegment("video-1");
      yield* segmentOps.renameSegment(created.id, "Intro");

      const updated = yield* segmentOps.setSegmentKind(
        created.id,
        "playthrough"
      );

      expect(updated.kind).toBe("playthrough");
      expect(updated.title).toBe("Intro");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("deleteSegment", () => {
  it.effect("archives the segment instead of hard-deleting", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;
      const created = yield* segmentOps.createSegment("video-1");

      yield* segmentOps.deleteSegment(created.id);

      // Archived segments are excluded from listing
      const remaining = yield* segmentOps.listSegmentsByVideoId("video-1");
      expect(remaining).toHaveLength(0);

      // But the row still exists in the database
      const row = yield* Effect.promise(() =>
        testDb.query.segments.findFirst({
          where: eq(segments.id, created.id),
        })
      );
      expect(row).toBeDefined();
      expect(row!.archived).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("excludes archived segments from listSegmentsByVideoId", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;
      const a = yield* segmentOps.createSegment("video-1");
      const b = yield* segmentOps.createSegment("video-1");

      yield* segmentOps.deleteSegment(a.id);

      const listed = yield* segmentOps.listSegmentsByVideoId("video-1");
      expect(listed).toHaveLength(1);
      expect(listed[0]!.id).toBe(b.id);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("moveSegment", () => {
  it.effect("reorders within a video, producing a key between neighbours", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;
      const a = yield* segmentOps.createSegment("video-1");
      const b = yield* segmentOps.createSegment("video-1");
      const c = yield* segmentOps.createSegment("video-1");

      // Move c to sit before b → order a, c, b.
      yield* segmentOps.moveSegment(c.id, "video-1", b.id);

      const listed = yield* segmentOps.listSegmentsByVideoId("video-1");
      expect(listed.map((s) => s.id)).toEqual([a.id, c.id, b.id]);
      const moved = listed.find((s) => s.id === c.id)!;
      expect(compareOrderStrings(a.order, moved.order)).toBeLessThan(0);
      expect(compareOrderStrings(moved.order, b.order)).toBeLessThan(0);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("appends to the end when beforeSegmentId is null", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const segmentOps = yield* SegmentOperationsService;
      const a = yield* segmentOps.createSegment("video-1");
      const b = yield* segmentOps.createSegment("video-1");

      yield* segmentOps.moveSegment(a.id, "video-1", null);

      const listed = yield* segmentOps.listSegmentsByVideoId("video-1");
      expect(listed.map((s) => s.id)).toEqual([b.id, a.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "reassigns videoId and orders within the target on cross-video move",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => makeVideo("video-1"));
        yield* Effect.promise(() => makeVideo("video-2"));
        const segmentOps = yield* SegmentOperationsService;
        const a = yield* segmentOps.createSegment("video-1");
        const d = yield* segmentOps.createSegment("video-2");

        // Move a into video-2, before d → video-2: [a, d]; video-1 empty.
        const moved = yield* segmentOps.moveSegment(a.id, "video-2", d.id);

        expect(moved.videoId).toBe("video-2");
        const v1 = yield* segmentOps.listSegmentsByVideoId("video-1");
        const v2 = yield* segmentOps.listSegmentsByVideoId("video-2");
        expect(v1).toHaveLength(0);
        expect(v2.map((s) => s.id)).toEqual([a.id, d.id]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "preserves the segment's description across a cross-video move",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => makeVideo("video-1"));
        yield* Effect.promise(() => makeVideo("video-2"));
        const segmentOps = yield* SegmentOperationsService;
        const a = yield* segmentOps.createSegment("video-1");
        yield* segmentOps.setSegmentDescription(
          a.id,
          "travels with the segment"
        );

        const moved = yield* segmentOps.moveSegment(a.id, "video-2", null);

        expect(moved.videoId).toBe("video-2");
        expect(moved.description).toBe("travels with the segment");
      }).pipe(Effect.provide(testLayer))
  );
});
