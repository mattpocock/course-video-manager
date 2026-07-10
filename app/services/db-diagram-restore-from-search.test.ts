import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let testLayer: Layer.Layer<DiagramOperationsService>;

beforeAll(async () => {
  const result = await createTestDb();
  testDb = result.testDb;

  const drizzleLayer = Layer.succeed(DrizzleService, testDb as any);
  testLayer = DiagramOperationsService.Default.pipe(
    Layer.provide(drizzleLayer)
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

const scene1 = {
  store: { "shape:a": { id: "a", x: 1 } },
  schema: { schemaVersion: 2 },
};
const scene2 = {
  store: { "shape:b": { id: "b", x: 2 } },
  schema: { schemaVersion: 2 },
};

describe("restoreFromSearch", () => {
  it.effect(
    "auto-preserves outgoing head and loads target scene onto head",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const diagram = yield* diagramOps.createDiagram();

        yield* diagramOps.updateDiagramHead(diagram.id, scene1);
        const snapshot = yield* diagramOps.createSnapshot(diagram.id, {
          preserved: true,
        });

        yield* diagramOps.updateDiagramHead(diagram.id, scene2);

        const result = yield* diagramOps.restoreFromSearch(
          diagram.id,
          snapshot.id
        );

        expect(result.headScene).toEqual(scene1);

        const snapshots = yield* diagramOps.listSnapshots(diagram.id);
        const preservedSnapshots = snapshots.filter((s) => s.preserved);
        expect(preservedSnapshots).toHaveLength(2);
        const scene2Snapshot = snapshots.find((s) =>
          expect.objectContaining(scene2).asymmetricMatch(s.scene)
        );
        expect(scene2Snapshot).toBeDefined();
        expect(scene2Snapshot!.preserved).toBe(true);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("no-op when head already matches the target snapshot", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagramHead(diagram.id, scene1);
      const snapshot = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });

      const snapshotsBefore = yield* diagramOps.listSnapshots(diagram.id);

      const result = yield* diagramOps.restoreFromSearch(
        diagram.id,
        snapshot.id
      );

      expect(result.headScene).toEqual(scene1);

      const snapshotsAfter = yield* diagramOps.listSnapshots(diagram.id);
      expect(snapshotsAfter).toHaveLength(snapshotsBefore.length);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "does not create a duplicate when outgoing head matches an existing snapshot",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const diagram = yield* diagramOps.createDiagram();

        yield* diagramOps.updateDiagramHead(diagram.id, scene1);
        const snap1 = yield* diagramOps.createSnapshot(diagram.id, {
          preserved: true,
        });

        yield* diagramOps.updateDiagramHead(diagram.id, scene2);
        const snap2 = yield* diagramOps.createSnapshot(diagram.id, {
          preserved: true,
        });

        yield* diagramOps.updateDiagramHead(diagram.id, scene1);

        yield* diagramOps.restoreFromSearch(diagram.id, snap2.id);

        const snapshots = yield* diagramOps.listSnapshots(diagram.id);
        expect(snapshots).toHaveLength(2);
        expect(snapshots.find((s) => s.id === snap1.id)!.preserved).toBe(true);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("promotes a non-preserved matching snapshot to preserved", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagramHead(diagram.id, scene1);
      const unpinnedSnap = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: false,
      });
      expect(unpinnedSnap.preserved).toBe(false);

      yield* diagramOps.updateDiagramHead(diagram.id, scene2);
      const targetSnap = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });

      yield* diagramOps.updateDiagramHead(diagram.id, scene1);

      yield* diagramOps.restoreFromSearch(diagram.id, targetSnap.id);

      const snapshots = yield* diagramOps.listSnapshots(diagram.id);
      const promotedSnap = snapshots.find((s) => s.id === unpinnedSnap.id)!;
      expect(promotedSnap.preserved).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for non-existent snapshot", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      const result = yield* diagramOps
        .restoreFromSearch(diagram.id, "nonexistent-snapshot-id")
        .pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );
});
