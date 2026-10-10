import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { clips, diagrams, diagramSnapshots } from "../db/schema.js";
import {
  DiagramHeadMovedError,
  NotFoundError,
  UnknownDBServiceError,
} from "./db-service-errors.js";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNotNull,
  max,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { Effect } from "effect";
import { hashHead, hashScene } from "../lib/scene-hash.js";
import { extractSceneText } from "../lib/extract-scene-text/index.js";
import {
  agentDiagramOperations,
  type DiagramPrimitives,
} from "./db-diagram-agent-operations.server.js";
import {
  DiagramThumbnailStore,
  type DiagramThumbnailStoreApi,
} from "./diagram-thumbnail-store.js";
import { listDiagramSummariesIn } from "./db-diagram-summaries.server.js";
import { lockDiagram } from "./lock-diagram.server.js";
import { withDbTransaction } from "./with-db-transaction.server.js";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/** `restoreFromSearch`'s body; `db` must be its transaction. */
const restoreFromSearchIn = (
  db: Database,
  { storeSnapshot, restoreSnapshotToHead }: DiagramPrimitives
) =>
  Effect.fn("restoreFromSearch")(function* (
    diagramId: string,
    snapshotId: string
  ) {
    const diagram = yield* lockDiagram(db, diagramId, "restoreFromSearch");

    const snapshot = yield* makeDbCall(() =>
      db.query.diagramSnapshots.findFirst({
        where: and(
          eq(diagramSnapshots.id, snapshotId),
          eq(diagramSnapshots.diagramId, diagramId)
        ),
      })
    );

    if (!snapshot) {
      return yield* new NotFoundError({
        type: "restoreFromSearch",
        params: { diagramId, snapshotId },
      });
    }

    if (hashHead(diagram.headScene) === snapshot.contentHash) {
      return diagram;
    }

    if (diagram.headScene != null) {
      yield* storeSnapshot(diagramId, diagram.headScene, { preserved: true });
    }

    return yield* restoreSnapshotToHead(diagramId, snapshotId);
  });

const createDiagramOperations = (
  db: Database,
  thumbnails: DiagramThumbnailStoreApi
) => {
  /** The lowest "Untitled N" no live Diagram is already called. */
  const nextUntitledName = Effect.fn("nextUntitledName")(function* () {
    const existing = yield* makeDbCall(() =>
      db.query.diagrams.findMany({
        where: eq(diagrams.archived, false),
      })
    );

    const usedNumbers = new Set(
      existing
        .map((d) => {
          const match = d.name.match(/^Untitled (\d+)$/);
          return match ? Number(match[1]) : null;
        })
        .filter((n): n is number => n !== null)
    );

    let nextNumber = 1;
    while (usedNumbers.has(nextNumber)) {
      nextNumber++;
    }
    return `Untitled ${nextNumber}`;
  });

  /**
   * A new, empty Diagram: "Untitled N" unless a name is given. Its head starts
   * empty; a drawing reaches it only through a snapshot (see
   * `createDiagramFromSnapshots`) or the playground's own head writes.
   */
  const createDiagram = Effect.fn("createDiagram")(function* (opts?: {
    name?: string;
  }) {
    const name = opts?.name?.trim() || (yield* nextUntitledName());

    const results = yield* makeDbCall(() =>
      db.insert(diagrams).values({ name }).returning()
    );

    const diagram = results[0];
    if (!diagram) {
      return yield* new UnknownDBServiceError({
        cause: "No diagram was returned from the database",
      });
    }
    return diagram;
  });

  /**
   * The Diagram rail: metadata only, never the drawing. The playground polls
   * this every few seconds, so pulling every `head_scene` here would ship
   * every Diagram's full drawing on every poll. Read a drawing with
   * `getDiagram` or `getDiagramHead`.
   */
  const listDiagrams = Effect.fn("listDiagrams")(function* (opts?: {
    includeArchived?: boolean;
    nameFilter?: string;
  }) {
    const conditions: SQL[] = [];
    if (!opts?.includeArchived) {
      conditions.push(eq(diagrams.archived, false));
    }
    if (opts?.nameFilter) {
      conditions.push(ilike(diagrams.name, `%${opts.nameFilter}%`));
    }

    // Per-diagram lastClipPinAt: max(createdAt) of non-archived clips
    // pinning to any snapshot of the diagram. Computed as a left-joinable
    // subquery so the sort surface accepts both inputs (lastClipPinAt and
    // headUpdatedAt) without restructuring as new pin sources land.
    const lastClipPinAt = db
      .select({
        diagramId: diagramSnapshots.diagramId,
        lastClipPinAt: max(clips.createdAt).as("last_clip_pin_at"),
      })
      .from(diagramSnapshots)
      .innerJoin(clips, eq(clips.diagramSnapshotId, diagramSnapshots.id))
      .where(eq(clips.archived, false))
      .groupBy(diagramSnapshots.diagramId)
      .as("last_clip_pin");

    return yield* makeDbCall(() =>
      db
        .select({
          id: diagrams.id,
          name: diagrams.name,
          archived: diagrams.archived,
          createdAt: diagrams.createdAt,
          updatedAt: diagrams.updatedAt,
        })
        .from(diagrams)
        .leftJoin(lastClipPinAt, eq(lastClipPinAt.diagramId, diagrams.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          desc(
            sql`GREATEST(${lastClipPinAt.lastClipPinAt}, ${diagrams.updatedAt})`
          )
        )
    );
  });

  const searchDiagrams = Effect.fn("searchDiagrams")(function* (query: string) {
    const tsQuery = sql`websearch_to_tsquery('english', ${query})`;

    const lastClipPinAt = db
      .select({
        diagramId: diagramSnapshots.diagramId,
        lastClipPinAt: max(clips.createdAt).as("last_clip_pin_at"),
      })
      .from(diagramSnapshots)
      .innerJoin(clips, eq(clips.diagramSnapshotId, diagramSnapshots.id))
      .where(eq(clips.archived, false))
      .groupBy(diagramSnapshots.diagramId)
      .as("last_clip_pin");

    const recencyExpr = sql<Date>`GREATEST(${lastClipPinAt.lastClipPinAt}, ${diagrams.updatedAt})`;

    const snapshotResults = yield* makeDbCall(() =>
      db
        .select({
          snapshotId: diagramSnapshots.id,
          diagramId: diagrams.id,
          diagramName: diagrams.name,
          contentHash: diagramSnapshots.contentHash,
          searchText: diagramSnapshots.searchText,
          sortKey: recencyExpr.as("sort_key"),
        })
        .from(diagramSnapshots)
        .innerJoin(diagrams, eq(diagramSnapshots.diagramId, diagrams.id))
        .leftJoin(lastClipPinAt, eq(lastClipPinAt.diagramId, diagrams.id))
        .where(
          and(
            eq(diagrams.archived, false),
            eq(diagramSnapshots.archived, false),
            sql`${diagramSnapshots.searchVector} @@ ${tsQuery}`
          )
        )
        .orderBy(desc(recencyExpr))
    );

    const headResults = yield* makeDbCall(() =>
      db
        .select({
          diagramId: diagrams.id,
          diagramName: diagrams.name,
          headScene: diagrams.headScene,
          searchText: diagrams.searchText,
          sortKey: recencyExpr.as("sort_key"),
        })
        .from(diagrams)
        .leftJoin(lastClipPinAt, eq(lastClipPinAt.diagramId, diagrams.id))
        .where(
          and(
            eq(diagrams.archived, false),
            isNotNull(diagrams.headScene),
            or(
              sql`${diagrams.searchVector} @@ ${tsQuery}`,
              ilike(diagrams.name, `%${query}%`)
            )
          )
        )
    );

    const snapshotHashesByDiagram = new Map<string, Set<string>>();
    for (const s of snapshotResults) {
      let hashes = snapshotHashesByDiagram.get(s.diagramId);
      if (!hashes) {
        hashes = new Set();
        snapshotHashesByDiagram.set(s.diagramId, hashes);
      }
      hashes.add(s.contentHash);
    }

    type SearchResult = {
      snapshotId: string | null;
      diagramId: string;
      diagramName: string;
      contentHash: string;
      searchText: string | null;
      source: "snapshot" | "current";
      sortKey: Date;
    };

    const results: SearchResult[] = snapshotResults.map((s) => ({
      snapshotId: s.snapshotId,
      diagramId: s.diagramId,
      diagramName: s.diagramName,
      contentHash: s.contentHash,
      searchText: s.searchText,
      source: "snapshot" as const,
      sortKey: s.sortKey,
    }));

    for (const h of headResults) {
      const headHash = hashScene(h.headScene);
      const existingHashes = snapshotHashesByDiagram.get(h.diagramId);
      if (existingHashes?.has(headHash)) continue;

      results.push({
        snapshotId: null,
        diagramId: h.diagramId,
        diagramName: h.diagramName,
        contentHash: headHash,
        searchText: h.searchText,
        source: "current" as const,
        sortKey: h.sortKey,
      });
    }

    results.sort(
      (a, b) => new Date(b.sortKey).getTime() - new Date(a.sortKey).getTime()
    );

    return results;
  });

  const getDiagram = Effect.fn("getDiagram")(function* (id: string) {
    const diagram = yield* makeDbCall(() =>
      db.query.diagrams.findFirst({
        where: eq(diagrams.id, id),
      })
    );

    if (!diagram) {
      return yield* new NotFoundError({
        type: "getDiagram",
        params: { id },
      });
    }
    return diagram;
  });

  /**
   * One Diagram's stored head and when it was written — the drawing without
   * the search text and vector `getDiagram` also carries.
   */
  const getDiagramHead = Effect.fn("getDiagramHead")(function* (id: string) {
    const rows = yield* makeDbCall(() =>
      db
        .select({
          id: diagrams.id,
          headScene: diagrams.headScene,
          updatedAt: diagrams.updatedAt,
        })
        .from(diagrams)
        .where(eq(diagrams.id, id))
    );

    const head = rows[0];
    if (!head) {
      return yield* new NotFoundError({
        type: "getDiagramHead",
        params: { id },
      });
    }
    return head;
  });

  const updateDiagram = Effect.fn("updateDiagram")(function* (
    id: string,
    fields: { name?: string; archived?: boolean }
  ) {
    const results = yield* makeDbCall(() =>
      db
        .update(diagrams)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(diagrams.id, id))
        .returning()
    );

    const diagram = results[0];
    if (!diagram) {
      return yield* new NotFoundError({
        type: "updateDiagram",
        params: { id },
      });
    }
    return diagram;
  });

  /**
   * Store `headScene` as the Diagram's head. With `expectedHash`, the write
   * only lands over the head the caller last saw (`hashHead` of it; `null`
   * for an empty one) and fails with `DiagramHeadMovedError` otherwise, so a
   * writer never overwrites a head it hasn't seen. Writing the drawing already
   * stored is a no-op either way.
   */
  const updateDiagramHead = Effect.fn("updateDiagramHead")(function* (
    id: string,
    headScene: unknown,
    opts: { expectedHash?: string | null } = {}
  ) {
    const newHash = hashHead(headScene);
    const searchText = extractSceneText(headScene);

    const outcome = yield* makeDbCall(() =>
      db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(diagrams)
          .where(eq(diagrams.id, id))
          .for("update");
        if (!existing) return { kind: "not-found" as const };

        const existingHash = hashHead(existing.headScene);
        if (existingHash === newHash) {
          return { kind: "stored" as const, diagram: existing };
        }
        if (
          opts.expectedHash !== undefined &&
          opts.expectedHash !== existingHash
        ) {
          return { kind: "moved" as const, storedHash: existingHash };
        }

        const [diagram] = await tx
          .update(diagrams)
          .set({ headScene, searchText, updatedAt: new Date() })
          .where(eq(diagrams.id, id))
          .returning();
        return diagram
          ? { kind: "stored" as const, diagram }
          : { kind: "not-found" as const };
      })
    );

    switch (outcome.kind) {
      case "not-found":
        return yield* new NotFoundError({
          type: "updateDiagramHead",
          params: { id },
        });
      case "moved":
        return yield* new DiagramHeadMovedError({
          diagramId: id,
          expectedHash: opts.expectedHash ?? null,
          storedHash: outcome.storedHash,
        });
      case "stored":
        return outcome.diagram;
    }
  });

  /**
   * Keep `scene` as one of the Diagram's snapshots. Snapshots are unique per
   * drawing (content hash), so storing a drawing the Diagram already holds
   * returns that snapshot, preserving it if asked.
   */
  const storeSnapshot = Effect.fn("storeSnapshot")(function* (
    diagramId: string,
    scene: unknown,
    opts: { preserved?: boolean; thumbnailPng?: Buffer }
  ) {
    const contentHash = hashScene(scene);
    const preserved = opts.preserved ?? false;

    // Write thumbnail before DB so a row never references a missing file.
    // Thumbnails are keyed by (diagramId, contentHash) so writing on every
    // snapshot that supplies one is safe and lets auto-pin snapshots show a
    // preview without requiring the user to hit "Preserve".
    if (opts.thumbnailPng) {
      yield* Effect.try({
        try: () =>
          thumbnails.writeDiagramThumbnail(
            diagramId,
            contentHash,
            opts.thumbnailPng!
          ),
        catch: (e) => new UnknownDBServiceError({ cause: e }),
      });
    }

    const existing = yield* makeDbCall(() =>
      db.query.diagramSnapshots.findFirst({
        where: and(
          eq(diagramSnapshots.diagramId, diagramId),
          eq(diagramSnapshots.contentHash, contentHash)
        ),
      })
    );

    if (existing) {
      if (preserved && !existing.preserved) {
        const updated = yield* makeDbCall(() =>
          db
            .update(diagramSnapshots)
            .set({ preserved: true })
            .where(eq(diagramSnapshots.id, existing.id))
            .returning()
        );
        return updated[0]!;
      }
      return existing;
    }

    const searchText = extractSceneText(scene);

    const results = yield* makeDbCall(() =>
      db
        .insert(diagramSnapshots)
        .values({
          diagramId,
          scene,
          contentHash,
          preserved,
          searchText,
          // The statement's own time, not the transaction's: snapshots
          // stored in one transaction keep the order they were stored in.
          createdAt: sql`clock_timestamp()`,
        })
        .returning()
    );

    const snapshot = results[0];
    if (!snapshot) {
      return yield* new UnknownDBServiceError({
        cause: "No snapshot was returned from the database",
      });
    }
    return snapshot;
  });

  /**
   * Keep the Diagram's head as a snapshot — or, given `scene`, that drawing
   * instead: a canvas the head refused, kept so leaving it loses nothing. The
   * head is never moved.
   */
  const createSnapshot = Effect.fn("createSnapshot")(function* (
    diagramId: string,
    opts: { preserved?: boolean; thumbnailPng?: Buffer; scene?: unknown }
  ) {
    const diagram = yield* makeDbCall(() =>
      db.query.diagrams.findFirst({
        where: eq(diagrams.id, diagramId),
      })
    );

    if (!diagram) {
      return yield* new NotFoundError({
        type: "createSnapshot",
        params: { diagramId },
      });
    }

    const scene = opts.scene ?? diagram.headScene;
    if (scene == null) {
      return yield* new NotFoundError({
        type: "createSnapshot",
        params: { diagramId, reason: "headScene is null" },
      });
    }

    return yield* storeSnapshot(diagramId, scene, opts);
  });

  const listSnapshots = Effect.fn("listSnapshots")(function* (
    diagramId: string
  ) {
    return yield* makeDbCall(() =>
      db.query.diagramSnapshots.findMany({
        where: eq(diagramSnapshots.diagramId, diagramId),
        orderBy: [asc(diagramSnapshots.createdAt)],
      })
    );
  });

  const getDiagramSnapshot = Effect.fn("getDiagramSnapshot")(function* (
    snapshotId: string
  ) {
    const snapshot = yield* makeDbCall(() =>
      db.query.diagramSnapshots.findFirst({
        where: eq(diagramSnapshots.id, snapshotId),
      })
    );

    if (!snapshot) {
      return yield* new NotFoundError({
        type: "getDiagramSnapshot",
        params: { snapshotId },
      });
    }
    return snapshot;
  });

  const listSnapshotsWithClips = Effect.fn("listSnapshotsWithClips")(function* (
    diagramId: string
  ) {
    return yield* makeDbCall(() =>
      db.query.diagramSnapshots.findMany({
        where: and(
          eq(diagramSnapshots.diagramId, diagramId),
          eq(diagramSnapshots.archived, false)
        ),
        orderBy: [asc(diagramSnapshots.createdAt)],
        with: {
          clips: {
            columns: { id: true, archived: true },
          },
        },
      })
    );
  });

  const listAllSnapshotsWithClips = Effect.fn("listAllSnapshotsWithClips")(
    function* () {
      return yield* makeDbCall(() =>
        db.query.diagramSnapshots.findMany({
          where: eq(diagramSnapshots.archived, false),
          columns: {
            id: true,
            diagramId: true,
            contentHash: true,
            preserved: true,
            createdAt: true,
          },
          with: {
            clips: {
              columns: { id: true, archived: true },
            },
          },
        })
      );
    }
  );

  const setSnapshotArchived = Effect.fn("setSnapshotArchived")(function* (
    snapshotId: string,
    archived: boolean
  ) {
    const results = yield* makeDbCall(() =>
      db
        .update(diagramSnapshots)
        .set({ archived })
        .where(eq(diagramSnapshots.id, snapshotId))
        .returning()
    );

    const snapshot = results[0];
    if (!snapshot) {
      return yield* new NotFoundError({
        type: "setSnapshotArchived",
        params: { snapshotId },
      });
    }
    return snapshot;
  });

  const restoreSnapshotToHead = Effect.fn("restoreSnapshotToHead")(function* (
    diagramId: string,
    snapshotId: string
  ) {
    const snapshot = yield* makeDbCall(() =>
      db.query.diagramSnapshots.findFirst({
        where: and(
          eq(diagramSnapshots.id, snapshotId),
          eq(diagramSnapshots.diagramId, diagramId)
        ),
      })
    );

    if (!snapshot) {
      return yield* new NotFoundError({
        type: "restoreSnapshotToHead",
        params: { diagramId, snapshotId },
      });
    }

    const searchText = extractSceneText(snapshot.scene);

    const results = yield* makeDbCall(() =>
      db
        .update(diagrams)
        .set({
          headScene: snapshot.scene,
          searchText,
          updatedAt: new Date(),
        })
        .where(eq(diagrams.id, diagramId))
        .returning()
    );

    const diagram = results[0];
    if (!diagram) {
      return yield* new NotFoundError({
        type: "restoreSnapshotToHead",
        params: { diagramId },
      });
    }
    return diagram;
  });

  /** These operations bound to a transaction; typed to break the cycle. */
  const primitivesFor = (tx: Database): DiagramPrimitives =>
    createDiagramOperations(tx, thumbnails).primitives;

  /**
   * Load a snapshot found by search onto the head, preserving the outgoing
   * head first. One transaction, with the Diagram row locked (`lockDiagram`)
   * BEFORE the head is read, so an autosave can't land between the read and
   * the write and be silently replaced.
   */
  const restoreFromSearch = (diagramId: string, snapshotId: string) =>
    withDbTransaction(db, (tx) =>
      restoreFromSearchIn(tx, primitivesFor(tx))(diagramId, snapshotId)
    );

  const createSnapshotForClip = Effect.fn("createSnapshotForClip")(function* (
    diagramId: string,
    clipId: string,
    opts: { thumbnailPng?: Buffer } = {}
  ) {
    const snapshot = yield* createSnapshot(diagramId, {
      thumbnailPng: opts.thumbnailPng,
    });

    yield* makeDbCall(() =>
      db
        .update(clips)
        .set({ diagramSnapshotId: snapshot.id })
        .where(eq(clips.id, clipId))
    );

    return snapshot;
  });

  const updateClipDiagramPin = Effect.fn("updateClipDiagramPin")(function* (
    clipId: string,
    diagramSnapshotId: string | null
  ) {
    const results = yield* makeDbCall(() =>
      db
        .update(clips)
        .set({ diagramSnapshotId })
        .where(eq(clips.id, clipId))
        .returning()
    );

    const clip = results[0];
    if (!clip) {
      return yield* new NotFoundError({
        type: "updateClipDiagramPin",
        params: { clipId },
      });
    }
    return clip;
  });

  return {
    createDiagram,
    listDiagrams,
    listDiagramSummaries: listDiagramSummariesIn(db),
    searchDiagrams,
    getDiagram,
    getDiagramHead,
    updateDiagram,
    updateDiagramHead,
    createSnapshot,
    getDiagramSnapshot,
    listSnapshots,
    listSnapshotsWithClips,
    listAllSnapshotsWithClips,
    setSnapshotArchived,
    restoreSnapshotToHead,
    restoreFromSearch,
    ...agentDiagramOperations(db, primitivesFor),
    createSnapshotForClip,
    updateClipDiagramPin,
    /** What the agent writes are built from; bound to this `db`. */
    primitives: {
      createDiagram,
      storeSnapshot,
      setSnapshotArchived,
      restoreSnapshotToHead,
    },
  };
};

export class DiagramOperationsService extends Effect.Service<DiagramOperationsService>()(
  "DiagramOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      const thumbnails = yield* DiagramThumbnailStore;
      return createDiagramOperations(db, thumbnails);
    }),
  }
) {}
