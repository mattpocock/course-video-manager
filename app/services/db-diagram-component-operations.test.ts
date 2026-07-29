import { describe, it, expect } from "@effect/vitest";
import { beforeAll, beforeEach, afterAll } from "vitest";
import { Effect, Layer } from "effect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DiagramComponentOperationsService } from "@/services/db-diagram-component-operations.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { getComponentThumbnailPath } from "@/services/diagram-thumbnail-store.server";
import {
  createTestDb,
  truncateAllTables,
  type TestDb,
} from "@/test-utils/pglite";

let testDb: TestDb;
let testLayer: Layer.Layer<DiagramComponentOperationsService>;
let thumbnailsDir: string;

beforeAll(async () => {
  // Component creation writes a thumbnail file, exactly as snapshot
  // preservation does.
  thumbnailsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cvm-thumbs-"));
  process.env.DIAGRAM_THUMBNAILS_DIR = thumbnailsDir;

  const result = await createTestDb();
  testDb = result.testDb;
  testLayer = DiagramComponentOperationsService.Default.pipe(
    Layer.provide(Layer.succeed(DrizzleService, testDb as never))
  );
});

beforeEach(async () => {
  await truncateAllTables(testDb);
});

afterAll(() => {
  fs.rmSync(thumbnailsDir, { recursive: true, force: true });
});

const PNG = Buffer.from("fake-png-bytes");

// A real-time pause. `Effect.sleep` inside `it.effect` runs on the TestClock and
// would never resolve; these tests need Postgres's CURRENT_TIMESTAMP to actually
// advance between statements.
const tick = Effect.promise(
  () => new Promise((resolve) => setTimeout(resolve, 5))
);

/** The bare TLContent a capture produces, minus the `users` key. */
const fragment = (shapeCount = 1) => ({
  shapes: Array.from({ length: shapeCount }, (_, i) => ({
    id: `shape:s${i}`,
    type: "geo",
  })),
  bindings: [],
  assets: [],
  rootShapeIds: ["shape:s0"],
  schema: { schemaVersion: 2 },
});

const create = (name: string, overrides?: Record<string, unknown>) =>
  Effect.gen(function* () {
    const ops = yield* DiagramComponentOperationsService;
    return yield* ops.createComponent({
      name,
      sceneFragment: fragment(),
      thumbnailPng: PNG,
      ...overrides,
    });
  });

describe("createComponent", () => {
  it.effect("persists the fragment and trims the name", () =>
    Effect.gen(function* () {
      const ops = yield* DiagramComponentOperationsService;
      const created = yield* create("  Request/response pair  ");
      expect(created.name).toBe("Request/response pair");

      const taken = yield* ops.takeComponentForInsert(created.id);
      expect(taken.sceneFragment).toEqual(fragment());
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("writes the thumbnail file before the row exists", () =>
    Effect.gen(function* () {
      const created = yield* create("With a thumbnail");
      // A row must never reference a missing file.
      expect(fs.existsSync(getComponentThumbnailPath(created.id))).toBe(true);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects an empty name", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(create(""));
      expect(failure._tag).toBe("InvalidComponentError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects a whitespace-only name", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(create("   "));
      expect(failure._tag).toBe("InvalidComponentError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("allows duplicate names", () =>
    Effect.gen(function* () {
      yield* create("Same name");
      const second = yield* create("Same name");
      expect(second.name).toBe("Same name");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects a missing thumbnail", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        create("No thumbnail", { thumbnailPng: undefined })
      );
      expect(failure._tag).toBe("InvalidComponentError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects a fragment with no shapes", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        create("Empty", {
          sceneFragment: { ...fragment(), shapes: [] },
        })
      );
      expect(failure._tag).toBe("InvalidComponentError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects a fragment with no schema", () =>
    Effect.gen(function* () {
      const { schema: _schema, ...noSchema } = fragment();
      const failure = yield* Effect.flip(
        create("Schemaless", { sceneFragment: noSchema })
      );
      expect(failure._tag).toBe("InvalidComponentError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects a fragment that is not an object at all", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        create("Nonsense", { sceneFragment: "not an object" })
      );
      expect(failure._tag).toBe("InvalidComponentError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects a non-empty assets array — ADR 0003 leaked upstream", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        create("Has assets", {
          sceneFragment: { ...fragment(), assets: [{ id: "asset:1" }] },
        })
      );
      expect(failure._tag).toBe("InvalidComponentError");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("listComponents", () => {
  it.effect("returns id and name only", () =>
    Effect.gen(function* () {
      const ops = yield* DiagramComponentOperationsService;
      yield* create("Only one");
      const list = yield* ops.listComponents();
      expect(Object.keys(list[0]!).sort()).toEqual(["id", "name"]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "orders by lastUsedAt desc, so a never-used one sorts by birth",
    () =>
      Effect.gen(function* () {
        const ops = yield* DiagramComponentOperationsService;
        const first = yield* create("First");
        yield* tick;
        const second = yield* create("Second");

        const list = yield* ops.listComponents();
        expect(list.map((c) => c.id)).toEqual([second.id, first.id]);
      }).pipe(Effect.provide(testLayer))
  );

  it.effect(
    "is empty until something is captured — the library ships empty",
    () =>
      Effect.gen(function* () {
        const ops = yield* DiagramComponentOperationsService;
        expect(yield* ops.listComponents()).toEqual([]);
      }).pipe(Effect.provide(testLayer))
  );
});

describe("takeComponentForInsert", () => {
  it.effect("returns the fragment and floats the component to the top", () =>
    Effect.gen(function* () {
      const ops = yield* DiagramComponentOperationsService;
      const first = yield* create("First");
      yield* tick;
      const second = yield* create("Second");

      yield* tick;
      const taken = yield* ops.takeComponentForInsert(first.id);
      expect(taken.sceneFragment).toEqual(fragment());

      // Assert the reorder, not just the timestamp — recency of USE is the
      // whole point of the column.
      const list = yield* ops.listComponents();
      expect(list.map((c) => c.id)).toEqual([first.id, second.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("404s for an id that is not there", () =>
    Effect.gen(function* () {
      const ops = yield* DiagramComponentOperationsService;
      const failure = yield* Effect.flip(
        ops.takeComponentForInsert(crypto.randomUUID())
      );
      expect(failure._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("renameComponent", () => {
  it.effect("renames and trims", () =>
    Effect.gen(function* () {
      const ops = yield* DiagramComponentOperationsService;
      const created = yield* create("Hasty name");
      const renamed = yield* ops.renameComponent(created.id, "  Better name  ");
      expect(renamed.name).toBe("Better name");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("rejects an empty name, like diagram rename does", () =>
    Effect.gen(function* () {
      const ops = yield* DiagramComponentOperationsService;
      const created = yield* create("Named");
      const failure = yield* Effect.flip(ops.renameComponent(created.id, "  "));
      expect(failure._tag).toBe("InvalidComponentError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("does NOT bump recency — curation is not use", () =>
    Effect.gen(function* () {
      const ops = yield* DiagramComponentOperationsService;
      const first = yield* create("First");
      yield* tick;
      const second = yield* create("Second");

      yield* tick;
      yield* ops.renameComponent(first.id, "First, renamed");

      const list = yield* ops.listComponents();
      expect(list.map((c) => c.id)).toEqual([second.id, first.id]);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("404s for an id that is not there", () =>
    Effect.gen(function* () {
      const ops = yield* DiagramComponentOperationsService;
      const failure = yield* Effect.flip(
        ops.renameComponent(crypto.randomUUID(), "Whatever")
      );
      expect(failure._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );
});

describe("deleteComponent", () => {
  it.effect("hard-deletes: a subsequent take 404s", () =>
    Effect.gen(function* () {
      const ops = yield* DiagramComponentOperationsService;
      const created = yield* create("Doomed");
      yield* ops.deleteComponent(created.id);

      expect(yield* ops.listComponents()).toEqual([]);
      const failure = yield* Effect.flip(
        ops.takeComponentForInsert(created.id)
      );
      expect(failure._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("removes the thumbnail file, after the row", () =>
    Effect.gen(function* () {
      const ops = yield* DiagramComponentOperationsService;
      const created = yield* create("Doomed");
      yield* ops.deleteComponent(created.id);
      expect(fs.existsSync(getComponentThumbnailPath(created.id))).toBe(false);
    }).pipe(Effect.provide(testLayer))
  );

  it.effect("404s for an id that is not there", () =>
    Effect.gen(function* () {
      const ops = yield* DiagramComponentOperationsService;
      const failure = yield* Effect.flip(
        ops.deleteComponent(crypto.randomUUID())
      );
      expect(failure._tag).toBe("NotFoundError");
    }).pipe(Effect.provide(testLayer))
  );
});
