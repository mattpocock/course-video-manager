import {
  DrizzleService,
  type DrizzleDB,
} from "@/services/drizzle-service.server";
import { clips, diagrams, diagramSnapshots } from "@/db/schema";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { and, asc, desc, eq, ilike, max, sql, type SQL } from "drizzle-orm";
import { Effect } from "effect";
import { hashScene } from "@/lib/scene-hash";
import { writeThumbnail } from "@/services/diagram-thumbnail-store.server";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createDiagramOperations = (db: DrizzleDB) => {
  const createDiagram = Effect.fn("createDiagram")(function* () {
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

    const results = yield* makeDbCall(() =>
      db
        .insert(diagrams)
        .values({ name: `Untitled ${nextNumber}` })
        .returning()
    );

    const diagram = results[0];
    if (!diagram) {
      return yield* new UnknownDBServiceError({
        cause: "No diagram was returned from the database",
      });
    }
    return diagram;
  });

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
        .select({ diagram: diagrams })
        .from(diagrams)
        .leftJoin(lastClipPinAt, eq(lastClipPinAt.diagramId, diagrams.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(
          desc(
            sql`GREATEST(${lastClipPinAt.lastClipPinAt}, ${diagrams.updatedAt})`
          )
        )
        .then((rows) => rows.map((r) => r.diagram))
    );
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

  const updateDiagramHead = Effect.fn("updateDiagramHead")(function* (
    id: string,
    headScene: unknown
  ) {
    const existing = yield* makeDbCall(() =>
      db.query.diagrams.findFirst({
        where: eq(diagrams.id, id),
      })
    );

    if (!existing) {
      return yield* new NotFoundError({
        type: "updateDiagramHead",
        params: { id },
      });
    }

    const existingHash =
      existing.headScene == null ? null : hashScene(existing.headScene);
    const newHash = headScene == null ? null : hashScene(headScene);
    if (existingHash === newHash) {
      return existing;
    }

    const results = yield* makeDbCall(() =>
      db
        .update(diagrams)
        .set({ headScene, updatedAt: new Date() })
        .where(eq(diagrams.id, id))
        .returning()
    );

    const diagram = results[0];
    if (!diagram) {
      return yield* new NotFoundError({
        type: "updateDiagramHead",
        params: { id },
      });
    }
    return diagram;
  });

  const createSnapshot = Effect.fn("createSnapshot")(function* (
    diagramId: string,
    opts: { preserved?: boolean; thumbnailPng?: Buffer }
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

    if (diagram.headScene == null) {
      return yield* new NotFoundError({
        type: "createSnapshot",
        params: { diagramId, reason: "headScene is null" },
      });
    }

    const contentHash = hashScene(diagram.headScene);
    const preserved = opts.preserved ?? false;

    // Write thumbnail before DB so a row never references a missing file.
    // Thumbnails are keyed by (diagramId, contentHash) so writing on every
    // snapshot that supplies one is safe and lets auto-pin snapshots show a
    // preview without requiring the user to hit "Preserve".
    if (opts.thumbnailPng) {
      yield* Effect.try({
        try: () => writeThumbnail(diagramId, contentHash, opts.thumbnailPng!),
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

    const results = yield* makeDbCall(() =>
      db
        .insert(diagramSnapshots)
        .values({
          diagramId,
          scene: diagram.headScene!,
          contentHash,
          preserved,
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

    const results = yield* makeDbCall(() =>
      db
        .update(diagrams)
        .set({ headScene: snapshot.scene, updatedAt: new Date() })
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
    getDiagram,
    updateDiagram,
    updateDiagramHead,
    createSnapshot,
    getDiagramSnapshot,
    listSnapshots,
    listSnapshotsWithClips,
    listAllSnapshotsWithClips,
    setSnapshotArchived,
    restoreSnapshotToHead,
    createSnapshotForClip,
    updateClipDiagramPin,
  };
};

export class DiagramOperationsService extends Effect.Service<DiagramOperationsService>()(
  "DiagramOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createDiagramOperations(db);
    }),
  }
) {}
