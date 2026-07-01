import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import * as schema from "@/db/schema";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let testLayer: Layer.Layer<PitchOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  testLayer = PitchOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as any))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

async function seedDeliverable(
  db: TestDb,
  overrides: { status?: string } = {}
) {
  const [d] = await db
    .insert(schema.deliverables)
    .values({
      title: "Test deliverable",
      date: "2026-06-01",
      status: overrides.status ?? "planned",
    })
    .returning();
  return d!;
}

async function linkPitchToDeliverable(
  db: TestDb,
  pitchId: string,
  deliverableId: string
) {
  await db
    .insert(schema.deliverablesPitches)
    .values({ pitchId, deliverableId });
}

describe("state derivation via listPitches", () => {
  it.effect("pitch with no linked deliverable → idle", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const p = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p.id, "title", "Idle pitch");

      const list = yield* pitchOps.listPitches();
      expect(list).toHaveLength(1);
      expect(list[0]!.state).toBe("idle");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("pitch with one planned deliverable → scheduled", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pitch.id, "title", "Scheduled pitch");
      const del = yield* Effect.promise(() =>
        seedDeliverable(testDb, { status: "planned" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(testDb, pitch.id, del.id)
      );

      const list = yield* pitchOps.listPitches();
      expect(list[0]!.state).toBe("scheduled");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("pitch with one done deliverable → shipped", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pitch.id, "title", "Shipped pitch");
      const del = yield* Effect.promise(() =>
        seedDeliverable(testDb, { status: "done" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(testDb, pitch.id, del.id)
      );

      const list = yield* pitchOps.listPitches();
      expect(list[0]!.state).toBe("shipped");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("pitch with one done + one planned deliverable → scheduled", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pitch.id, "title", "Mixed pitch");
      const d1 = yield* Effect.promise(() =>
        seedDeliverable(testDb, { status: "done" })
      );
      const d2 = yield* Effect.promise(() =>
        seedDeliverable(testDb, { status: "planned" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(testDb, pitch.id, d1.id)
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(testDb, pitch.id, d2.id)
      );

      const list = yield* pitchOps.listPitches();
      expect(list[0]!.state).toBe("scheduled");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("pitch with all cancelled deliverables → shipped", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pitch.id, "title", "Cancelled pitch");
      const del = yield* Effect.promise(() =>
        seedDeliverable(testDb, { status: "cancelled" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(testDb, pitch.id, del.id)
      );

      const list = yield* pitchOps.listPitches();
      expect(list[0]!.state).toBe("shipped");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("archived pitch excluded regardless of pitch state", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pitch.id, "title", "Archived pitch");
      yield* pitchOps.updatePitchField(pitch.id, "archived", true);

      const list = yield* pitchOps.listPitches();
      expect(list).toHaveLength(0);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("default state filter returns idle + scheduled only", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pIdle = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pIdle.id, "title", "Idle");

      const pScheduled = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pScheduled.id, "title", "Scheduled");
      const d1 = yield* Effect.promise(() =>
        seedDeliverable(testDb, { status: "planned" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(testDb, pScheduled.id, d1.id)
      );

      const pShipped = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pShipped.id, "title", "Shipped");
      const d2 = yield* Effect.promise(() =>
        seedDeliverable(testDb, { status: "done" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(testDb, pShipped.id, d2.id)
      );

      const list = yield* pitchOps.listPitches({
        state: ["idle", "scheduled"],
      });
      expect(list).toHaveLength(2);
      const titles = list.map((p) => p.title);
      expect(titles).toContain("Idle");
      expect(titles).toContain("Scheduled");
      expect(titles).not.toContain("Shipped");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("state filter for shipped includes shipped pitches", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pIdle2 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pIdle2.id, "title", "Idle");

      const pShipped = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pShipped.id, "title", "Shipped");
      const del = yield* Effect.promise(() =>
        seedDeliverable(testDb, { status: "done" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(testDb, pShipped.id, del.id)
      );

      const list = yield* pitchOps.listPitches({
        state: ["shipped"],
      });
      expect(list).toHaveLength(1);
      expect(list[0]!.title).toBe("Shipped");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("ordering preserved: priority asc, createdAt desc", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const p1 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p1.id, "title", "P2 older");
      yield* pitchOps.updatePitchField(p1.id, "priority", 2);

      const p2 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p2.id, "title", "P1");
      yield* pitchOps.updatePitchField(p2.id, "priority", 1);

      const p3 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p3.id, "title", "P2 newer");
      yield* pitchOps.updatePitchField(p3.id, "priority", 2);

      const list = yield* pitchOps.listPitches();
      expect(list[0]!.title).toBe("P1");
      expect(list[1]!.title).toBe("P2 newer");
      expect(list[2]!.title).toBe("P2 older");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("state derivation via listPitchesWithVideos", () => {
  it.effect("attaches state alongside videos", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pitch = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pitch.id, "title", "With video");
      yield* pitchOps.createVideoFromPitch(pitch.id);
      const del = yield* Effect.promise(() =>
        seedDeliverable(testDb, { status: "planned" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(testDb, pitch.id, del.id)
      );

      const list = yield* pitchOps.listPitchesWithVideos();
      expect(list).toHaveLength(1);
      expect(list[0]!.state).toBe("scheduled");
      expect(list[0]!.videos).toHaveLength(1);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("state derivation via getPitchWithVideos", () => {
  it.effect("derives state from linked deliverables", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pitch = yield* pitchOps.createPitch();
      const del = yield* Effect.promise(() =>
        seedDeliverable(testDb, { status: "done" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(testDb, pitch.id, del.id)
      );

      const result = yield* pitchOps.getPitchWithVideos(pitch.id);
      expect(result.state).toBe("shipped");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns idle when no deliverables linked", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pitch = yield* pitchOps.createPitch();

      const result = yield* pitchOps.getPitchWithVideos(pitch.id);
      expect(result.state).toBe("idle");
    }).pipe(Effect.provide(testLayer))
  );
});
