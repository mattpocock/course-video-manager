import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { PitchOperationsService } from "@/services/db-pitch-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
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

describe("effort field", () => {
  it.effect("defaults to medium (2)", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const pitch = yield* pitchOps.createPitch();
      expect(pitch.effort).toBe(2);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("updates effort as a number", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;
      const created = yield* pitchOps.createPitch();
      const updated = yield* pitchOps.updatePitchField(created.id, "effort", 1);
      expect(updated.effort).toBe(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "sorts by effort within the same priority band (low effort first)",
    () =>
      Effect.gen(function* () {
        const pitchOps = yield* PitchOperationsService;

        const p1 = yield* pitchOps.createPitch();
        yield* pitchOps.updatePitchField(p1.id, "title", "P2 high-effort");
        yield* pitchOps.updatePitchField(p1.id, "priority", 2);
        yield* pitchOps.updatePitchField(p1.id, "effort", 3);

        const p2 = yield* pitchOps.createPitch();
        yield* pitchOps.updatePitchField(p2.id, "title", "P2 low-effort");
        yield* pitchOps.updatePitchField(p2.id, "priority", 2);
        yield* pitchOps.updatePitchField(p2.id, "effort", 1);

        const list = yield* pitchOps.listPitches();
        expect(list[0]!.title).toBe("P2 low-effort");
        expect(list[1]!.title).toBe("P2 high-effort");
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "priority still dominates — low-effort P3 sorts below high-effort P1",
    () =>
      Effect.gen(function* () {
        const pitchOps = yield* PitchOperationsService;

        const p1 = yield* pitchOps.createPitch();
        yield* pitchOps.updatePitchField(p1.id, "title", "P1 high-effort");
        yield* pitchOps.updatePitchField(p1.id, "priority", 1);
        yield* pitchOps.updatePitchField(p1.id, "effort", 3);

        const p2 = yield* pitchOps.createPitch();
        yield* pitchOps.updatePitchField(p2.id, "title", "P3 low-effort");
        yield* pitchOps.updatePitchField(p2.id, "priority", 3);
        yield* pitchOps.updatePitchField(p2.id, "effort", 1);

        const list = yield* pitchOps.listPitches();
        expect(list[0]!.title).toBe("P1 high-effort");
        expect(list[1]!.title).toBe("P3 low-effort");
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("filters by effort", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const p1 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p1.id, "title", "E1");
      yield* pitchOps.updatePitchField(p1.id, "effort", 1);

      const p2 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p2.id, "title", "E2");
      yield* pitchOps.updatePitchField(p2.id, "effort", 2);

      const p3 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p3.id, "title", "E3");
      yield* pitchOps.updatePitchField(p3.id, "effort", 3);

      const lowOnly = yield* pitchOps.listPitches({ effort: [1] });
      expect(lowOnly).toHaveLength(1);

      const lowAndMed = yield* pitchOps.listPitches({ effort: [1, 2] });
      expect(lowAndMed).toHaveLength(2);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("effort filter ANDs with priority and status", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const p1 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p1.id, "title", "P1E1");
      yield* pitchOps.updatePitchField(p1.id, "priority", 1);
      yield* pitchOps.updatePitchField(p1.id, "effort", 1);

      const p2 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p2.id, "title", "P1E3");
      yield* pitchOps.updatePitchField(p2.id, "priority", 1);
      yield* pitchOps.updatePitchField(p2.id, "effort", 3);

      const p3 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p3.id, "title", "P2E1");
      yield* pitchOps.updatePitchField(p3.id, "priority", 2);
      yield* pitchOps.updatePitchField(p3.id, "effort", 1);

      const result = yield* pitchOps.listPitches({
        priority: [1],
        effort: [1],
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe(p1.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("treats empty effort array as no effort filter", () =>
    Effect.gen(function* () {
      const pitchOps = yield* PitchOperationsService;

      const p1 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p1.id, "title", "A");
      yield* pitchOps.updatePitchField(p1.id, "effort", 1);
      const p2 = yield* pitchOps.createPitch();
      yield* pitchOps.updatePitchField(p2.id, "title", "B");
      yield* pitchOps.updatePitchField(p2.id, "effort", 3);

      const list = yield* pitchOps.listPitches({ effort: [] });
      expect(list).toHaveLength(2);
    }).pipe(Effect.provide(testLayer))
  );
});
