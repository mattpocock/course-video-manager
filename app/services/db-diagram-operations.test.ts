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

describe("createDiagram", () => {
  it.effect("creates a diagram with name Untitled 1 by default", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      expect(diagram.id).toEqual(expect.any(String));
      expect(diagram.name).toBe("Untitled 1");
      expect(diagram.headScene).toBeNull();
      expect(diagram.archived).toBe(false);
      expect(diagram.createdAt).toBeInstanceOf(Date);
      expect(diagram.updatedAt).toBeInstanceOf(Date);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("auto-increments Untitled N avoiding used numbers", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const d1 = yield* diagramOps.createDiagram();
      expect(d1.name).toBe("Untitled 1");

      const d2 = yield* diagramOps.createDiagram();
      expect(d2.name).toBe("Untitled 2");

      const d3 = yield* diagramOps.createDiagram();
      expect(d3.name).toBe("Untitled 3");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fills gaps in Untitled N numbering", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const d1 = yield* diagramOps.createDiagram();
      yield* diagramOps.createDiagram();
      yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagram(d1.id, { name: "My Diagram" });

      const d4 = yield* diagramOps.createDiagram();
      expect(d4.name).toBe("Untitled 1");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "does not count non-matching names toward Untitled N numbering",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const d1 = yield* diagramOps.createDiagram();
        yield* diagramOps.updateDiagram(d1.id, { name: "Custom Name" });

        const d2 = yield* diagramOps.createDiagram();
        expect(d2.name).toBe("Untitled 1");
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("does not count archived Untitled N names toward numbering", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const d1 = yield* diagramOps.createDiagram();
      expect(d1.name).toBe("Untitled 1");

      yield* diagramOps.updateDiagram(d1.id, { archived: true });

      const d2 = yield* diagramOps.createDiagram();
      expect(d2.name).toBe("Untitled 1");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("listDiagrams", () => {
  it.effect("returns non-archived diagrams sorted by updatedAt desc", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;

      const d1 = yield* diagramOps.createDiagram();
      const d2 = yield* diagramOps.createDiagram();

      // Force d1.updatedAt to be clearly newer
      yield* Effect.promise(() => new Promise((r) => setTimeout(r, 50)));
      yield* diagramOps.updateDiagram(d1.id, { name: "Updated Last" });

      const list = yield* diagramOps.listDiagrams();
      expect(list).toHaveLength(2);
      expect(list[0]!.id).toBe(d1.id);
      expect(list[1]!.id).toBe(d2.id);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("excludes archived diagrams by default", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;

      yield* diagramOps.createDiagram();
      const d2 = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagram(d2.id, { archived: true });

      const list = yield* diagramOps.listDiagrams();
      expect(list).toHaveLength(1);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("includes archived diagrams when requested", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;

      yield* diagramOps.createDiagram();
      const d2 = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagram(d2.id, { archived: true });

      const list = yield* diagramOps.listDiagrams({ includeArchived: true });
      expect(list).toHaveLength(2);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("filters by name substring case-insensitively", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;

      const d1 = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagram(d1.id, { name: "Architecture Overview" });

      const d2 = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagram(d2.id, { name: "Data Flow" });

      const d3 = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagram(d3.id, { name: "architecture detail" });

      const list = yield* diagramOps.listDiagrams({
        nameFilter: "architecture",
      });
      expect(list).toHaveLength(2);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns empty array when no diagrams exist", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const list = yield* diagramOps.listDiagrams();
      expect(list).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "filters by name among archived diagrams when includeArchived is true",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;

        const d1 = yield* diagramOps.createDiagram();
        yield* diagramOps.updateDiagram(d1.id, {
          name: "Architecture Overview",
        });

        const d2 = yield* diagramOps.createDiagram();
        yield* diagramOps.updateDiagram(d2.id, {
          name: "Architecture Detail",
          archived: true,
        });

        const d3 = yield* diagramOps.createDiagram();
        yield* diagramOps.updateDiagram(d3.id, { name: "Data Flow" });

        const withArchived = yield* diagramOps.listDiagrams({
          nameFilter: "architecture",
          includeArchived: true,
        });
        expect(withArchived).toHaveLength(2);

        const withoutArchived = yield* diagramOps.listDiagrams({
          nameFilter: "architecture",
          includeArchived: false,
        });
        expect(withoutArchived).toHaveLength(1);
        expect(withoutArchived[0]!.name).toBe("Architecture Overview");
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("returns no results when filter matches nothing", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      yield* diagramOps.createDiagram();

      const list = yield* diagramOps.listDiagrams({
        nameFilter: "nonexistent",
      });
      expect(list).toEqual([]);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("getDiagram", () => {
  it.effect("returns a diagram by id", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const created = yield* diagramOps.createDiagram();
      const fetched = yield* diagramOps.getDiagram(created.id);

      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe(created.name);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for missing id", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const result = yield* diagramOps
        .getDiagram("nonexistent-id")
        .pipe(Effect.flip);

      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("updateDiagram", () => {
  it.effect("renames a diagram and bumps updatedAt", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const created = yield* diagramOps.createDiagram();
      const originalUpdatedAt = created.updatedAt;

      const updated = yield* diagramOps.updateDiagram(created.id, {
        name: "New Name",
      });

      expect(updated.name).toBe("New Name");
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        originalUpdatedAt.getTime()
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("archives a diagram", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const created = yield* diagramOps.createDiagram();

      const updated = yield* diagramOps.updateDiagram(created.id, {
        archived: true,
      });
      expect(updated.archived).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("unarchives a diagram", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const created = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagram(created.id, { archived: true });

      const updated = yield* diagramOps.updateDiagram(created.id, {
        archived: false,
      });
      expect(updated.archived).toBe(false);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for non-existent diagram", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const result = yield* diagramOps
        .updateDiagram("nonexistent-id", { name: "Nope" })
        .pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("updating name does not change archived", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const created = yield* diagramOps.createDiagram();

      const updated = yield* diagramOps.updateDiagram(created.id, {
        name: "New Name",
      });
      expect(updated.name).toBe("New Name");
      expect(updated.archived).toBe(false);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("empty fields object still bumps updatedAt", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const created = yield* diagramOps.createDiagram();

      yield* Effect.promise(() => new Promise((r) => setTimeout(r, 50)));
      const updated = yield* diagramOps.updateDiagram(created.id, {});

      expect(updated.name).toBe(created.name);
      expect(updated.archived).toBe(created.archived);
      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        created.updatedAt.getTime()
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows setting name and archived in a single update", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const created = yield* diagramOps.createDiagram();

      const updated = yield* diagramOps.updateDiagram(created.id, {
        name: "Archived Diagram",
        archived: true,
      });
      expect(updated.name).toBe("Archived Diagram");
      expect(updated.archived).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("updateDiagramHead", () => {
  it.effect("stores headScene and bumps updatedAt", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const created = yield* diagramOps.createDiagram();
      expect(created.headScene).toBeNull();

      const scene = {
        store: { "shape:abc": { id: "shape:abc" } },
        schema: { schemaVersion: 2 },
      };
      const updated = yield* diagramOps.updateDiagramHead(created.id, scene);

      expect(updated.headScene).toEqual(scene);
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        created.updatedAt.getTime()
      );
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("overwrites previous headScene", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const created = yield* diagramOps.createDiagram();

      const scene1 = { store: { "shape:a": {} }, schema: { schemaVersion: 2 } };
      yield* diagramOps.updateDiagramHead(created.id, scene1);

      const scene2 = { store: { "shape:b": {} }, schema: { schemaVersion: 2 } };
      const updated = yield* diagramOps.updateDiagramHead(created.id, scene2);

      expect(updated.headScene).toEqual(scene2);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError for non-existent diagram", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const result = yield* diagramOps
        .updateDiagramHead("nonexistent-id", { store: {} })
        .pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("clears headScene when set to null", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const created = yield* diagramOps.createDiagram();

      const scene = { store: { "shape:a": {} }, schema: { schemaVersion: 2 } };
      yield* diagramOps.updateDiagramHead(created.id, scene);

      const cleared = yield* diagramOps.updateDiagramHead(created.id, null);
      expect(cleared.headScene).toBeNull();
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("preserves name and archived when updating head", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const created = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagram(created.id, {
        name: "My Diagram",
        archived: false,
      });

      const scene = { store: { "shape:x": {} } };
      const updated = yield* diagramOps.updateDiagramHead(created.id, scene);

      expect(updated.name).toBe("My Diagram");
      expect(updated.archived).toBe(false);
      expect(updated.headScene).toEqual(scene);
    }).pipe(Effect.provide(testLayer))
  );
});

describe("createSnapshot", () => {
  const scene = {
    store: { "shape:abc": { id: "abc", x: 10 } },
    schema: { schemaVersion: 2 },
  };

  it.effect("inserts a snapshot row from the diagram's headScene", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(diagram.id, scene);

      const snapshot = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: true,
      });

      expect(snapshot.id).toEqual(expect.any(String));
      expect(snapshot.diagramId).toBe(diagram.id);
      expect(snapshot.scene).toEqual(scene);
      expect(snapshot.contentHash).toEqual(expect.any(String));
      expect(snapshot.contentHash.length).toBe(64);
      expect(snapshot.preserved).toBe(true);
      expect(snapshot.createdAt).toBeInstanceOf(Date);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("defaults preserved to false", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(diagram.id, scene);

      const snapshot = yield* diagramOps.createSnapshot(diagram.id, {});

      expect(snapshot.preserved).toBe(false);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("deduplicates by contentHash — returns existing row", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(diagram.id, scene);

      const first = yield* diagramOps.createSnapshot(diagram.id, {});
      const second = yield* diagramOps.createSnapshot(diagram.id, {});

      expect(second.id).toBe(first.id);
      expect(second.contentHash).toBe(first.contentHash);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("dedup does not flip preserved:true back to false", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();
      yield* diagramOps.updateDiagramHead(diagram.id, scene);

      yield* diagramOps.createSnapshot(diagram.id, { preserved: true });
      const second = yield* diagramOps.createSnapshot(diagram.id, {
        preserved: false,
      });

      expect(second.preserved).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "dedup flips preserved:false to true when caller passes preserved:true",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;
        const diagram = yield* diagramOps.createDiagram();
        yield* diagramOps.updateDiagramHead(diagram.id, scene);

        const first = yield* diagramOps.createSnapshot(diagram.id, {
          preserved: false,
        });
        expect(first.preserved).toBe(false);

        const second = yield* diagramOps.createSnapshot(diagram.id, {
          preserved: true,
        });
        expect(second.id).toBe(first.id);
        expect(second.preserved).toBe(true);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect("different headScene content produces a new snapshot row", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      yield* diagramOps.updateDiagramHead(diagram.id, scene);
      const first = yield* diagramOps.createSnapshot(diagram.id, {});

      const scene2 = {
        store: { "shape:abc": { id: "abc", x: 999 } },
        schema: { schemaVersion: 2 },
      };
      yield* diagramOps.updateDiagramHead(diagram.id, scene2);
      const second = yield* diagramOps.createSnapshot(diagram.id, {});

      expect(second.id).not.toBe(first.id);
      expect(second.contentHash).not.toBe(first.contentHash);
      expect(second.scene).toEqual(scene2);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails with NotFoundError when diagram does not exist", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const result = yield* diagramOps
        .createSnapshot("nonexistent-id", {})
        .pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("fails when headScene is null", () =>
    Effect.gen(function* () {
      const diagramOps = yield* DiagramOperationsService;
      const diagram = yield* diagramOps.createDiagram();

      const result = yield* diagramOps
        .createSnapshot(diagram.id, {})
        .pipe(Effect.flip);
      expect(result._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "produces same hash regardless of key insertion order in headScene",
    () =>
      Effect.gen(function* () {
        const diagramOps = yield* DiagramOperationsService;

        const d1 = yield* diagramOps.createDiagram();
        yield* diagramOps.updateDiagramHead(d1.id, {
          store: { "shape:a": { id: "a", x: 1 } },
          schema: { schemaVersion: 2 },
        });
        const s1 = yield* diagramOps.createSnapshot(d1.id, {});

        const d2 = yield* diagramOps.createDiagram();
        yield* diagramOps.updateDiagramHead(d2.id, {
          schema: { schemaVersion: 2 },
          store: { "shape:a": { x: 1, id: "a" } },
        });
        const s2 = yield* diagramOps.createSnapshot(d2.id, {});

        expect(s1.contentHash).toBe(s2.contentHash);
      }).pipe(Effect.provide(testLayer))
  );
});
