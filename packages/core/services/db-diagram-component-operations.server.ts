/**
 * Component operations.
 *
 * Deliberately a NEW service rather than an extension of
 * `DiagramOperationsService`: that file is already 647 lines and every query in
 * it joins `diagrams` / `diagram_snapshots` / `clips`, none of which a
 * Component touches. The cost is one more Effect layer; the benefit is that
 * "a Component is not a Diagram" holds at the code seam and not just in prose.
 */

import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { diagramComponents } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { desc, eq, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import {
  DiagramThumbnailStore,
  type DiagramThumbnailStoreApi,
} from "./diagram-thumbnail-store.js";

/** A 400: the caller sent something a Component cannot be built from. */
export class InvalidComponentError extends Data.TaggedError(
  "InvalidComponentError"
)<{
  message: string;
}> {}

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

/**
 * A minimal shape guard, not a validation of tldraw's record schema — that
 * would mean importing tldraw into the server bundle to re-derive something the
 * client already produced correctly.
 */
function checkSceneFragment(fragment: unknown) {
  return Effect.gen(function* () {
    if (
      fragment === null ||
      typeof fragment !== "object" ||
      Array.isArray(fragment)
    ) {
      return yield* new InvalidComponentError({
        message: "sceneFragment must be an object",
      });
    }

    const f = fragment as Record<string, unknown>;
    if (!Array.isArray(f.shapes) || f.shapes.length === 0) {
      return yield* new InvalidComponentError({
        message: "sceneFragment must carry a non-empty shapes array",
      });
    }
    if (f.schema === undefined || f.schema === null) {
      return yield* new InvalidComponentError({
        message: "sceneFragment must carry a schema",
      });
    }
    // ADR 0003 bans image/video/embed shapes in v1, so assets are always empty
    // in practice; a non-empty array means the ban leaked upstream. Two lines
    // that turn a silent ADR violation into a loud one. Delete this check when
    // the ban lifts.
    if (Array.isArray(f.assets) && f.assets.length > 0) {
      return yield* new InvalidComponentError({
        message: "Components cannot carry assets (ADR 0003 bans asset shapes)",
      });
    }
  });
}

export const createDiagramComponentOperations = (
  db: Database,
  thumbnails: DiagramThumbnailStoreApi
) => {
  const createComponent = Effect.fn("createComponent")(function* (input: {
    name: string;
    sceneFragment: unknown;
    thumbnailPng: Buffer | undefined;
  }) {
    // A component is ONLY findable by name, so an unnamed one is dead weight —
    // there is no `Untitled N` auto-naming here, unlike diagrams.
    const name = input.name.trim();
    if (!name) {
      return yield* new InvalidComponentError({
        message: "Name cannot be empty",
      });
    }

    yield* checkSceneFragment(input.sceneFragment);

    // A component with no thumbnail is unusable in a grid picker, so there is
    // no meaningful degraded state — mandatory, like a preserved snapshot's.
    // A zero-byte buffer counts as none: an empty base64 string decodes to one,
    // and writing it would leave a row pointing at an unrenderable file.
    const thumbnailPng = input.thumbnailPng;
    if (!thumbnailPng || thumbnailPng.length === 0) {
      return yield* new InvalidComponentError({
        message: "Components require a thumbnail",
      });
    }

    const id = crypto.randomUUID();

    // Thumbnail file BEFORE the DB row: a row must never reference a missing
    // file.
    yield* Effect.try({
      try: () => thumbnails.writeComponentThumbnail(id, thumbnailPng),
      catch: (e) => new UnknownDBServiceError({ cause: e }),
    });

    const rows = yield* makeDbCall(() =>
      db
        .insert(diagramComponents)
        .values({ id, name, sceneFragment: input.sceneFragment })
        .returning()
    );

    const row = rows[0];
    if (!row) {
      return yield* new UnknownDBServiceError({
        cause: "No component was returned from the database",
      });
    }
    return { id: row.id, name: row.name, createdAt: row.createdAt };
  });

  /** `{id, name}` only — the server owns the ordering, and nothing displays a date. */
  const listComponents = Effect.fn("listComponents")(function* () {
    return yield* makeDbCall(() =>
      db
        .select({ id: diagramComponents.id, name: diagramComponents.name })
        .from(diagramComponents)
        .orderBy(desc(diagramComponents.lastUsedAt))
    );
  });

  /**
   * Named `takeComponentForInsert` rather than `getComponent` because the name
   * carries the recency write: reading a fragment for insertion IS what "use"
   * means, and only insertion bumps `lastUsedAt`.
   */
  const takeComponentForInsert = Effect.fn("takeComponentForInsert")(function* (
    id: string
  ) {
    const rows = yield* makeDbCall(() =>
      db
        .update(diagramComponents)
        .set({ lastUsedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(diagramComponents.id, id))
        .returning()
    );

    const row = rows[0];
    if (!row) {
      return yield* new NotFoundError({
        type: "takeComponentForInsert",
        params: { id },
      });
    }
    return { id: row.id, name: row.name, sceneFragment: row.sceneFragment };
  });

  /** Rename does NOT bump recency — curation is not use. */
  const renameComponent = Effect.fn("renameComponent")(function* (
    id: string,
    name: string
  ) {
    const trimmed = name.trim();
    if (!trimmed) {
      return yield* new InvalidComponentError({
        message: "Name cannot be empty",
      });
    }

    const rows = yield* makeDbCall(() =>
      db
        .update(diagramComponents)
        .set({ name: trimmed })
        .where(eq(diagramComponents.id, id))
        .returning()
    );

    const row = rows[0];
    if (!row) {
      return yield* new NotFoundError({
        type: "renameComponent",
        params: { id },
      });
    }
    return { id: row.id, name: row.name };
  });

  /** Hard DELETE — permanent, by design. See the table comment. */
  const deleteComponent = Effect.fn("deleteComponent")(function* (id: string) {
    const rows = yield* makeDbCall(() =>
      db
        .delete(diagramComponents)
        .where(eq(diagramComponents.id, id))
        .returning()
    );

    const row = rows[0];
    if (!row) {
      return yield* new NotFoundError({
        type: "deleteComponent",
        params: { id },
      });
    }

    // Row first, THEN the file: an orphaned file wastes bytes; a live row
    // pointing at a missing file is a broken tile.
    yield* Effect.sync(() => thumbnails.deleteComponentThumbnail(id));
    return { id: row.id };
  });

  return {
    createComponent,
    listComponents,
    takeComponentForInsert,
    renameComponent,
    deleteComponent,
  };
};

export class DiagramComponentOperationsService extends Effect.Service<DiagramComponentOperationsService>()(
  "DiagramComponentOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      const thumbnails = yield* DiagramThumbnailStore;
      return createDiagramComponentOperations(db, thumbnails);
    }),
  }
) {}
