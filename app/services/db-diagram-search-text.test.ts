import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import { eq, sql } from "drizzle-orm";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";
import { diagrams } from "@/db/schema";

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

describe("createSnapshot searchText", () => {
  it.effect("sets searchText from scene text content at insert", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      const sceneWithText = {
        store: {
          "shape:1": {
            typeName: "shape",
            type: "text",
            props: { text: "boundary crossing" },
          },
        },
        schema: { schemaVersion: 2 },
      };
      yield* diagramOps.updateDiagramHead(diagram.id, sceneWithText);

      const snapshot = yield* diagramOps.createSnapshot(diagram.id, {});
      expect(snapshot.searchText).toBe("boundary crossing");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("dedup/preserve-flip does not overwrite searchText", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      const sceneWithText = {
        store: {
          "shape:1": {
            typeName: "shape",
            type: "text",
            props: { text: "hello world" },
          },
        },
        schema: { schemaVersion: 2 },
      };
      yield* diagramOps.updateDiagramHead(diagram.id, sceneWithText);

      const first = yield* diagramOps.createSnapshot(diagram.id, {});
      expect(first.searchText).toBe("hello world");

      const second = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });
      expect(second.searchText).toBe("hello world");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("updateDiagramHead searchText", () => {
  it.effect("populates searchText when scene changes", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      const sceneWithText = {
        store: {
          "shape:1": {
            typeName: "shape",
            type: "geo",
            props: { text: "architecture overview" },
          },
        },
        schema: { schemaVersion: 2 },
      };
      yield* diagramOps.updateDiagramHead(diagram.id, sceneWithText);

      const rows = yield* Effect.promise(() =>
        testDb
          .select({ searchText: diagrams.searchText })
          .from(diagrams)
          .where(eq(diagrams.id, diagram.id))
      );
      expect(rows[0]!.searchText).toBe("architecture overview");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("sets searchText to empty string for null head", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      const sceneWithText = {
        store: {
          "shape:1": {
            typeName: "shape",
            type: "text",
            props: { text: "something" },
          },
        },
        schema: { schemaVersion: 2 },
      };
      yield* diagramOps.updateDiagramHead(diagram.id, sceneWithText);
      yield* diagramOps.updateDiagramHead(diagram.id, null);

      const rows = yield* Effect.promise(() =>
        testDb
          .select({ searchText: diagrams.searchText })
          .from(diagrams)
          .where(eq(diagrams.id, diagram.id))
      );
      expect(rows[0]!.searchText).toBe("");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("does not recompute searchText when scene hash is unchanged", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      const scene1 = {
        store: {
          "shape:1": {
            typeName: "shape",
            type: "text",
            props: { text: "unchanged" },
          },
        },
        schema: { schemaVersion: 2 },
      };
      yield* diagramOps.updateDiagramHead(diagram.id, scene1);
      const result = yield* diagramOps.updateDiagramHead(diagram.id, scene1);
      expect(result.id).toBe(diagram.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("search_vector is generated and queryable via tsvector", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      const sceneWithText = {
        store: {
          "shape:1": {
            typeName: "shape",
            type: "text",
            props: { text: "boundary crossing patterns" },
          },
        },
        schema: { schemaVersion: 2 },
      };
      yield* diagramOps.updateDiagramHead(diagram.id, sceneWithText);

      const rows = yield* Effect.promise(() =>
        testDb.execute(
          sql`SELECT id FROM ${diagrams} WHERE search_vector @@ to_tsquery('english', 'boundary')`
        )
      );
      expect(rows.rows).toHaveLength(1);
      expect((rows.rows[0] as any).id).toBe(diagram.id);
    }).pipe(Effect.provide(testLayer))
  );
});
