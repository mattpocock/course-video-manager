import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { BeatOperationsService } from "@/services/db-beat-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { beats, videos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { compareOrderStrings } from "@/lib/sort-by-order";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let testLayer: Layer.Layer<BeatOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = BeatOperationsService.Default.pipe(
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

describe("createBeat", () => {
  it.effect("defaults to the definition kind with an empty title", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;

      const beat = yield* beatOps.createBeat("video-1");

      expect(beat.kind).toBe("definition");
      expect(beat.title).toBe("");
      expect(beat.description).toBe("");
      expect(beat.videoId).toBe("video-1");
      expect(beat.order).toEqual(expect.any(String));
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("uses the provided kind", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;

      const beat = yield* beatOps.createBeat("video-1", "quest");

      expect(beat.kind).toBe("quest");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("slots new beats at the end, in creation order", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;

      const first = yield* beatOps.createBeat("video-1");
      const second = yield* beatOps.createBeat("video-1");
      const third = yield* beatOps.createBeat("video-1");

      expect(compareOrderStrings(first.order, second.order)).toBeLessThan(0);
      expect(compareOrderStrings(second.order, third.order)).toBeLessThan(0);

      const listed = yield* beatOps.listBeatsByVideoId("video-1");
      expect(listed.map((s) => s.id)).toEqual([first.id, second.id, third.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("stores the provided title", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;

      const beat = yield* beatOps.createBeat(
        "video-1",
        "quest",
        null,
        "Closures"
      );

      expect(beat.title).toBe("Closures");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("inserts before the anchor beat when given beforeBeatId", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;

      const first = yield* beatOps.createBeat("video-1");
      const third = yield* beatOps.createBeat("video-1");
      // Slot a new beat immediately before `third`.
      const second = yield* beatOps.createBeat("video-1", "quest", third.id);

      expect(compareOrderStrings(first.order, second.order)).toBeLessThan(0);
      expect(compareOrderStrings(second.order, third.order)).toBeLessThan(0);

      const listed = yield* beatOps.listBeatsByVideoId("video-1");
      expect(listed.map((s) => s.id)).toEqual([first.id, second.id, third.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("inserts at the front when the anchor is the first beat", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;

      const first = yield* beatOps.createBeat("video-1");
      const zeroth = yield* beatOps.createBeat(
        "video-1",
        "definition",
        first.id
      );

      const listed = yield* beatOps.listBeatsByVideoId("video-1");
      expect(listed.map((s) => s.id)).toEqual([zeroth.id, first.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when beforeBeatId does not exist", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;

      const result = yield* beatOps
        .createBeat("video-1", "definition", "missing")
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("scopes order to each video independently", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      yield* Effect.promise(() => makeVideo("video-2"));
      const beatOps = yield* BeatOperationsService;

      yield* beatOps.createBeat("video-1");
      yield* beatOps.createBeat("video-2");

      const v1 = yield* beatOps.listBeatsByVideoId("video-1");
      const v2 = yield* beatOps.listBeatsByVideoId("video-2");
      expect(v1).toHaveLength(1);
      expect(v2).toHaveLength(1);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("renameBeat", () => {
  it.effect("updates the title", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;
      const created = yield* beatOps.createBeat("video-1");

      const renamed = yield* beatOps.renameBeat(created.id, "Closures");

      expect(renamed.title).toBe("Closures");
      expect(renamed.kind).toBe("definition");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when the beat does not exist", () =>
    Effect.gen(function* () {
      const beatOps = yield* BeatOperationsService;
      const result = yield* beatOps
        .renameBeat("missing", "x")
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("setBeatDescription", () => {
  it.effect("persists the description while preserving title and kind", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;
      const created = yield* beatOps.createBeat("video-1", "quest");
      yield* beatOps.renameBeat(created.id, "Closures");

      const updated = yield* beatOps.setBeatDescription(
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
      const beatOps = yield* BeatOperationsService;
      const created = yield* beatOps.createBeat("video-1");
      yield* beatOps.setBeatDescription(created.id, "draft note");

      const cleared = yield* beatOps.setBeatDescription(created.id, "");

      expect(cleared.description).toBe("");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when the beat does not exist", () =>
    Effect.gen(function* () {
      const beatOps = yield* BeatOperationsService;
      const result = yield* beatOps
        .setBeatDescription("missing", "x")
        .pipe(Effect.either);
      expect(result._tag).toBe("Left");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("setBeatKind", () => {
  it.effect("changes the kind while preserving the title", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;
      const created = yield* beatOps.createBeat("video-1");
      yield* beatOps.renameBeat(created.id, "Intro");

      const updated = yield* beatOps.setBeatKind(created.id, "playthrough");

      expect(updated.kind).toBe("playthrough");
      expect(updated.title).toBe("Intro");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("deleteBeat", () => {
  it.effect("archives the beat instead of hard-deleting", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;
      const created = yield* beatOps.createBeat("video-1");

      yield* beatOps.deleteBeat(created.id);

      // Archived beats are excluded from listing
      const remaining = yield* beatOps.listBeatsByVideoId("video-1");
      expect(remaining).toHaveLength(0);

      // But the row still exists in the database
      const row = yield* Effect.promise(() =>
        testDb.query.beats.findFirst({
          where: eq(beats.id, created.id),
        })
      );
      expect(row).toBeDefined();
      expect(row!.archived).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("excludes archived beats from listBeatsByVideoId", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;
      const a = yield* beatOps.createBeat("video-1");
      const b = yield* beatOps.createBeat("video-1");

      yield* beatOps.deleteBeat(a.id);

      const listed = yield* beatOps.listBeatsByVideoId("video-1");
      expect(listed).toHaveLength(1);
      expect(listed[0]!.id).toBe(b.id);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("moveBeat", () => {
  it.effect("reorders within a video, producing a key between neighbours", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;
      const a = yield* beatOps.createBeat("video-1");
      const b = yield* beatOps.createBeat("video-1");
      const c = yield* beatOps.createBeat("video-1");

      // Move c to sit before b → order a, c, b.
      yield* beatOps.moveBeat(c.id, "video-1", b.id);

      const listed = yield* beatOps.listBeatsByVideoId("video-1");
      expect(listed.map((s) => s.id)).toEqual([a.id, c.id, b.id]);
      const moved = listed.find((s) => s.id === c.id)!;
      expect(compareOrderStrings(a.order, moved.order)).toBeLessThan(0);
      expect(compareOrderStrings(moved.order, b.order)).toBeLessThan(0);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("appends to the end when beforeBeatId is null", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      const beatOps = yield* BeatOperationsService;
      const a = yield* beatOps.createBeat("video-1");
      const b = yield* beatOps.createBeat("video-1");

      yield* beatOps.moveBeat(a.id, "video-1", null);

      const listed = yield* beatOps.listBeatsByVideoId("video-1");
      expect(listed.map((s) => s.id)).toEqual([b.id, a.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "reassigns videoId and orders within the target on cross-video move",
    () =>
      Effect.gen(function* () {
        yield* Effect.promise(() => makeVideo("video-1"));
        yield* Effect.promise(() => makeVideo("video-2"));
        const beatOps = yield* BeatOperationsService;
        const a = yield* beatOps.createBeat("video-1");
        const d = yield* beatOps.createBeat("video-2");

        // Move a into video-2, before d → video-2: [a, d]; video-1 empty.
        const moved = yield* beatOps.moveBeat(a.id, "video-2", d.id);

        expect(moved.videoId).toBe("video-2");
        const v1 = yield* beatOps.listBeatsByVideoId("video-1");
        const v2 = yield* beatOps.listBeatsByVideoId("video-2");
        expect(v1).toHaveLength(0);
        expect(v2.map((s) => s.id)).toEqual([a.id, d.id]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("preserves the beat's description across a cross-video move", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => makeVideo("video-1"));
      yield* Effect.promise(() => makeVideo("video-2"));
      const beatOps = yield* BeatOperationsService;
      const a = yield* beatOps.createBeat("video-1");
      yield* beatOps.setBeatDescription(a.id, "travels with the beat");

      const moved = yield* beatOps.moveBeat(a.id, "video-2", null);

      expect(moved.videoId).toBe("video-2");
      expect(moved.description).toBe("travels with the beat");
    }).pipe(Effect.provide(testLayer))
  );
});
