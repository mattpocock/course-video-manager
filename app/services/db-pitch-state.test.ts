import { describe, it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import * as schema from "@/db/schema";
import { setupEffectTest } from "@/test-utils/setup-effect-test";

const ctx = setupEffectTest(PitchOperationsService.Default);

async function seedDeliverable(
  db: typeof ctx.db,
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
  db: typeof ctx.db,
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
      yield* pitchOps.createPitch();

      const list = yield* pitchOps.listPitches();
      expect(list).toHaveLength(1);
      expect(list[0]!.state).toBe("idle");
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("pitch with one planned deliverable → scheduled", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      const del = yield* Effect.promise(() =>
        seedDeliverable(ctx.db, { status: "planned" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(ctx.db, pitch.id, del.id)
      );

      const list = yield* pitchOps.listPitches();
      expect(list[0]!.state).toBe("scheduled");
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("pitch with one done deliverable → shipped", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      const del = yield* Effect.promise(() =>
        seedDeliverable(ctx.db, { status: "done" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(ctx.db, pitch.id, del.id)
      );

      const list = yield* pitchOps.listPitches();
      expect(list[0]!.state).toBe("shipped");
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("pitch with one done + one planned deliverable → scheduled", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      const d1 = yield* Effect.promise(() =>
        seedDeliverable(ctx.db, { status: "done" })
      );
      const d2 = yield* Effect.promise(() =>
        seedDeliverable(ctx.db, { status: "planned" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(ctx.db, pitch.id, d1.id)
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(ctx.db, pitch.id, d2.id)
      );

      const list = yield* pitchOps.listPitches();
      expect(list[0]!.state).toBe("scheduled");
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("pitch with all cancelled deliverables → shipped", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      const del = yield* Effect.promise(() =>
        seedDeliverable(ctx.db, { status: "cancelled" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(ctx.db, pitch.id, del.id)
      );

      const list = yield* pitchOps.listPitches();
      expect(list[0]!.state).toBe("shipped");
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("archived pitch excluded regardless of pitch state", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pitch.id, "archived", true);

      const list = yield* pitchOps.listPitches();
      expect(list).toHaveLength(0);
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("default state filter returns idle + scheduled only", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pIdle = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pIdle.id, "title", "Idle");

      const pScheduled = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pScheduled.id, "title", "Scheduled");
      const d1 = yield* Effect.promise(() =>
        seedDeliverable(ctx.db, { status: "planned" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(ctx.db, pScheduled.id, d1.id)
      );

      const pShipped = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pShipped.id, "title", "Shipped");
      const d2 = yield* Effect.promise(() =>
        seedDeliverable(ctx.db, { status: "done" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(ctx.db, pShipped.id, d2.id)
      );

      const list = yield* pitchOps.listPitches({
        state: ["idle", "scheduled"],
      });
      expect(list).toHaveLength(2);
      const titles = list.map((p) => p.title);
      expect(titles).toContain("Idle");
      expect(titles).toContain("Scheduled");
      expect(titles).not.toContain("Shipped");
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("state filter for shipped includes shipped pitches", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      yield* pitchOps.createPitch();

      const pShipped = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(pShipped.id, "title", "Shipped");
      const del = yield* Effect.promise(() =>
        seedDeliverable(ctx.db, { status: "done" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(ctx.db, pShipped.id, del.id)
      );

      const list = yield* pitchOps.listPitches({
        state: ["shipped"],
      });
      expect(list).toHaveLength(1);
      expect(list[0]!.title).toBe("Shipped");
    }).pipe(Effect.provide(ctx.testLayer))
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
    }).pipe(Effect.provide(ctx.testLayer))
  );
});

describe("state derivation via listPitchesWithVideos", () => {
  it.effect("attaches state alongside videos", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pitch = yield* pitchOps.createPitch();
      yield* pitchOps.createVideoFromPitch(pitch.id);
      const del = yield* Effect.promise(() =>
        seedDeliverable(ctx.db, { status: "planned" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(ctx.db, pitch.id, del.id)
      );

      const list = yield* pitchOps.listPitchesWithVideos();
      expect(list).toHaveLength(1);
      expect(list[0]!.state).toBe("scheduled");
      expect(list[0]!.videos).toHaveLength(1);
    }).pipe(Effect.provide(ctx.testLayer))
  );
});

describe("state derivation via getPitchWithVideos", () => {
  it.effect("derives state from linked deliverables", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pitch = yield* pitchOps.createPitch();
      const del = yield* Effect.promise(() =>
        seedDeliverable(ctx.db, { status: "done" })
      );
      yield* Effect.promise(() =>
        linkPitchToDeliverable(ctx.db, pitch.id, del.id)
      );

      const result = yield* pitchOps.getPitchWithVideos(pitch.id);
      expect(result.state).toBe("shipped");
    }).pipe(Effect.provide(ctx.testLayer))
  );

  it.effect("returns idle when no deliverables linked", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const pitch = yield* pitchOps.createPitch();

      const result = yield* pitchOps.getPitchWithVideos(pitch.id);
      expect(result.state).toBe("idle");
    }).pipe(Effect.provide(ctx.testLayer))
  );
});
