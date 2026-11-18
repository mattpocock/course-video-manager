import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { withDbTransaction } from "./with-db-transaction.server.js";
import { thumbnails } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import {
  mergeThumbnailDiagramSources,
  type ThumbnailDiagramSource,
} from "../lib/thumbnail-diagram-sources.js";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

const createThumbnailOperations = (db: Database) => {
  const getThumbnailsByVideoId = Effect.fn("getThumbnailsByVideoId")(function* (
    videoId: string
  ) {
    return yield* makeDbCall(() =>
      db.query.thumbnails.findMany({
        where: and(
          eq(thumbnails.videoId, videoId),
          isNull(thumbnails.archivedAt)
        ),
        orderBy: desc(thumbnails.createdAt),
      })
    );
  });

  const createThumbnail = Effect.fn("createThumbnail")(function* (params: {
    videoId: string;
    layers: unknown;
    filePath: string | null;
    /** A tldraw `document`; null for a pasted-PNG Thumbnail (ADR 0060). */
    thumbnailDiagram: unknown;
    /** Where its inserts came from; none when nothing was inserted. */
    diagramSources?: readonly ThumbnailDiagramSource[];
  }) {
    const [record] = yield* makeDbCall(() =>
      db
        .insert(thumbnails)
        .values({
          videoId: params.videoId,
          layers: params.layers,
          filePath: params.filePath,
          thumbnailDiagram: params.thumbnailDiagram,
          diagramSources: mergeThumbnailDiagramSources(
            [],
            params.diagramSources ?? []
          ),
        })
        .returning()
    );
    if (!record) {
      return yield* Effect.die("Failed to create thumbnail");
    }
    return record;
  });

  const getThumbnailById = Effect.fn("getThumbnailById")(function* (
    thumbnailId: string
  ) {
    const thumbnail = yield* makeDbCall(() =>
      db.query.thumbnails.findFirst({
        where: eq(thumbnails.id, thumbnailId),
      })
    );

    if (!thumbnail) {
      return yield* new NotFoundError({
        type: "getThumbnailById",
        params: { thumbnailId },
      });
    }

    return thumbnail;
  });

  const updateThumbnail = Effect.fn("updateThumbnail")(function* (
    thumbnailId: string,
    params: {
      layers: unknown;
      filePath: string | null;
      /** Replaces the stored Thumbnail Diagram; null for a pasted-PNG one. */
      thumbnailDiagram: unknown;
      /**
       * Sources of inserts since the page opened the Thumbnail. Added to the
       * recorded ones, never replacing them: a link is never lost (ADR 0060).
       */
      diagramSources?: readonly ThumbnailDiagramSource[];
    }
  ) {
    const updated = yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        const [existing] = yield* makeDbCall(() =>
          tx
            .select({ diagramSources: thumbnails.diagramSources })
            .from(thumbnails)
            .where(eq(thumbnails.id, thumbnailId))
            .for("update")
        );
        if (!existing) return undefined;
        const [row] = yield* makeDbCall(() =>
          tx
            .update(thumbnails)
            .set({
              layers: params.layers,
              filePath: params.filePath,
              thumbnailDiagram: params.thumbnailDiagram,
              diagramSources: mergeThumbnailDiagramSources(
                existing.diagramSources,
                params.diagramSources ?? []
              ),
            })
            .where(eq(thumbnails.id, thumbnailId))
            .returning()
        );
        return row;
      })
    );

    if (!updated) {
      return yield* new NotFoundError({
        type: "updateThumbnail",
        params: { thumbnailId },
      });
    }

    return updated;
  });

  /**
   * The author's Delete. The row and its files stay, so the Thumbnail still
   * resolves by id wherever it was recorded as a source (ADR 0060); it drops
   * out of `getThumbnailsByVideoId` and can no longer be uploaded. Archiving
   * an archived Thumbnail keeps its first `archivedAt`.
   */
  const archiveThumbnail = Effect.fn("archiveThumbnail")(function* (
    thumbnailId: string
  ) {
    const [archived] = yield* makeDbCall(() =>
      db
        .update(thumbnails)
        .set({ archivedAt: sql`COALESCE(${thumbnails.archivedAt}, now())` })
        .where(eq(thumbnails.id, thumbnailId))
        .returning()
    );

    if (!archived) {
      return yield* new NotFoundError({
        type: "archiveThumbnail",
        params: { thumbnailId },
      });
    }

    return archived;
  });

  return {
    getThumbnailsByVideoId,
    createThumbnail,
    getThumbnailById,
    updateThumbnail,
    archiveThumbnail,
  };
};

export class ThumbnailOperationsService extends Effect.Service<ThumbnailOperationsService>()(
  "ThumbnailOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createThumbnailOperations(db);
    }),
  }
) {}
