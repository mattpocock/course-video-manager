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

function makeTextScene(text: string) {
  return {
    store: {
      "shape:1": {
        typeName: "shape",
        type: "text",
        props: { text },
      },
    },
    schema: { schemaVersion: 2 },
  };
}

describe("searchDiagrams", () => {
  it.effect(
    "returns snapshot-grain results: N matching snapshots yield N results",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const diagram = yield* diagramOps.createDiagram();

        yield* diagramOps.updateDiagramHead(
          diagram.id,
          makeTextScene("boundary analysis")
        );
        yield* diagramOps.createSnapshot(diagram.id, { preserved: true });

        yield* diagramOps.updateDiagramHead(
          diagram.id,
          makeTextScene("boundary crossing")
        );
        yield* diagramOps.createSnapshot(diagram.id, { preserved: true });

        const results = yield* diagramOps.searchDiagrams("boundary");
        expect(results).toHaveLength(2);
        expect(results.every((r) => r.diagramId === diagram.id)).toBe(true);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("AND across terms: multi-word requires all words", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagramHead(
        diagram.id,
        makeTextScene("boundary crossing patterns")
      );

      const matchBoth = yield* diagramOps.searchDiagrams("boundary crossing");
      expect(matchBoth.length).toBeGreaterThanOrEqual(1);

      const noMatch = yield* diagramOps.searchDiagrams("boundary unrelated");
      expect(noMatch).toHaveLength(0);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("OR widens the search across terms", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;

      const d1 = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(d1.id, makeTextScene("boundary"));

      const d2 = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(d2.id, makeTextScene("crossing"));

      const results = yield* diagramOps.searchDiagrams("boundary or crossing");
      expect(results).toHaveLength(2);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("stemming matches word forms (boundary → boundaries)", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(
        diagram.id,
        makeTextScene("boundaries")
      );

      const results = yield* diagramOps.searchDiagrams("boundary");
      expect(results).toHaveLength(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "matching head surfaces as a current result when no snapshot exists",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const diagram = yield* diagramOps.createDiagram();
        yield* diagramOps.updateDiagramHead(
          diagram.id,
          makeTextScene("boundary")
        );

        const results = yield* diagramOps.searchDiagrams("boundary");
        expect(results).toHaveLength(1);
        expect(results[0]!.source).toBe("current");
        expect(results[0]!.snapshotId).toBeNull();
        expect(results[0]!.diagramId).toBe(diagram.id);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("head↔snapshot dedup: identical head shows only snapshot", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagramHead(
        diagram.id,
        makeTextScene("boundary")
      );
      const snapshot = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });

      const results = yield* diagramOps.searchDiagrams("boundary");
      expect(results).toHaveLength(1);
      expect(results[0]!.snapshotId).toBe(snapshot.id);
      expect(results[0]!.source).toBe("snapshot");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("results ordered by GREATEST(lastClipPinAt, updatedAt) desc", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;

      const d1 = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(d1.id, makeTextScene("shared term"));

      yield* Effect.promise(() => new Promise((r) => setTimeout(r, 50)));

      const d2 = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(d2.id, makeTextScene("shared term"));

      const results = yield* diagramOps.searchDiagrams("shared");
      expect(results).toHaveLength(2);
      expect(results[0]!.diagramId).toBe(d2.id);
      expect(results[1]!.diagramId).toBe(d1.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("name-only match returns current head, not all snapshots", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagram(diagram.id, {
        name: "Architecture Overview",
      });

      yield* diagramOps.updateDiagramHead(
        diagram.id,
        makeTextScene("unrelated content v1")
      );
      yield* diagramOps.createSnapshot(diagram.id, { preserved: true });

      yield* diagramOps.updateDiagramHead(
        diagram.id,
        makeTextScene("unrelated content v2")
      );
      yield* diagramOps.createSnapshot(diagram.id, { preserved: true });

      yield* diagramOps.updateDiagramHead(
        diagram.id,
        makeTextScene("unrelated content v3")
      );

      const results = yield* diagramOps.searchDiagrams("architecture");
      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe("current");
      expect(results[0]!.diagramName).toBe("Architecture Overview");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("excludes archived diagrams", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(
        diagram.id,
        makeTextScene("boundary")
      );
      yield* diagramOps.updateDiagram(diagram.id, { archived: true });

      const results = yield* diagramOps.searchDiagrams("boundary");
      expect(results).toHaveLength(0);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("excludes archived snapshots", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(
        diagram.id,
        makeTextScene("boundary")
      );
      const snapshot = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });
      yield* diagramOps.setSnapshotArchived(snapshot.id, true);

      yield* diagramOps.updateDiagramHead(
        diagram.id,
        makeTextScene("boundary updated")
      );

      const results = yield* diagramOps.searchDiagrams("boundary");
      expect(results.every((r) => r.snapshotId !== snapshot.id)).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns empty array when nothing matches", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      yield* diagramOps.createDiagram();

      const results = yield* diagramOps.searchDiagrams("nonexistent");
      expect(results).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("includes searchText and contentHash in results", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(
        diagram.id,
        makeTextScene("boundary")
      );

      const results = yield* diagramOps.searchDiagrams("boundary");
      expect(results).toHaveLength(1);
      expect(results[0]!.searchText).toBe("boundary");
      expect(results[0]!.contentHash).toEqual(expect.any(String));
      expect(results[0]!.contentHash.length).toBe(64);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("head with null headScene does not appear", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagram(diagram.id, { name: "Boundary Diagram" });

      const results = yield* diagramOps.searchDiagrams("boundary");
      expect(results.filter((r) => r.source === "current")).toHaveLength(0);
    }).pipe(Effect.provide(testLayer))
  );
});
