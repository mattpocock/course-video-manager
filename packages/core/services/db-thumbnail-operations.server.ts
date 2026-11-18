import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { withDbTransaction } from "./with-db-transaction.server.js";
import { thumbnails, videos } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import {
  mergeThumbnailDiagramSources,
  type ThumbnailDiagramSource,
} from "../lib/thumbnail-diagram-sources.js";
import { extractSceneText } from "../lib/extract-scene-text/index.js";
import { requireDraftVersionForVideo } from "./draft-guard.server.js";
import {
  collapseVersionCopies,
  type ThumbnailDiagramDocument,
  type ThumbnailDiagramHit,
} from "../lib/thumbnail-diagram.js";
import { escapeLike } from "../lib/escape-like.js";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

/** What diagram search reads of a Thumbnail Diagram; null without one. */
export const diagramSearchTextOf = (thumbnailDiagram: unknown) =>
  thumbnailDiagram == null ? null : extractSceneText(thumbnailDiagram);

/** A diagram search hit, with when its Thumbnail was made, for ordering. */
type ThumbnailDiagramSearchRow = ThumbnailDiagramHit & { sortKey: Date };

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

  /** Every write runs the Draft guard in its own transaction (DRAFT_GUARD.md). */
  const createThumbnail = Effect.fn("createThumbnail")(function* (params: {
    videoId: string;
    layers: unknown;
    filePath: string | null;
    /** A tldraw `document`; null for a pasted-PNG Thumbnail (ADR 0060). */
    thumbnailDiagram: ThumbnailDiagramDocument | null;
    /** Where its inserts came from; empty when nothing was inserted. */
    diagramSources: readonly ThumbnailDiagramSource[];
  }) {
    const record = yield* withDbTransaction(db, (tx) =>
      Effect.gen(function* () {
        yield* requireDraftVersionForVideo(tx, params.videoId);
        const [row] = yield* makeDbCall(() =>
          tx
            .insert(thumbnails)
            .values({
              videoId: params.videoId,
              layers: params.layers,
              filePath: params.filePath,
              thumbnailDiagram: params.thumbnailDiagram,
              diagramSearchText: diagramSearchTextOf(params.thumbnailDiagram),
              diagramSources: mergeThumbnailDiagramSources(
                [],
                params.diagramSources
              ),
            })
            .returning()
        );
        return row;
      })
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

  /**
   * Writes `set(existing)` to one Thumbnail: the row locked, and the Draft
   * guard run, in the write's own transaction. NotFoundError if missing.
   */
  const writeThumbnail = (
    type: string,
    thumbnailId: string,
    set: (existing: {
      diagramSources: ThumbnailDiagramSource[];
    }) => PgUpdateSetSource<typeof thumbnails>
  ) =>
    Effect.gen(function* () {
      const written = yield* withDbTransaction(db, (tx) =>
        Effect.gen(function* () {
          const [existing] = yield* makeDbCall(() =>
            tx
              .select({
                videoId: thumbnails.videoId,
                diagramSources: thumbnails.diagramSources,
              })
              .from(thumbnails)
              .where(eq(thumbnails.id, thumbnailId))
              .for("update")
          );
          if (!existing) return undefined;
          yield* requireDraftVersionForVideo(tx, existing.videoId);
          const [row] = yield* makeDbCall(() =>
            tx
              .update(thumbnails)
              .set(set(existing))
              .where(eq(thumbnails.id, thumbnailId))
              .returning()
          );
          return row;
        })
      );
      if (!written) {
        return yield* new NotFoundError({ type, params: { thumbnailId } });
      }
      return written;
    });

  const updateThumbnail = Effect.fn("updateThumbnail")(function* (
    thumbnailId: string,
    params: {
      layers: unknown;
      filePath: string | null;
      /** Replaces the stored Thumbnail Diagram; null for a pasted-PNG one. */
      thumbnailDiagram: ThumbnailDiagramDocument | null;
      /**
       * Sources of inserts since the page opened the Thumbnail. Added to the
       * recorded ones, never replacing them: a link is never lost (ADR 0060).
       */
      diagramSources: readonly ThumbnailDiagramSource[];
    }
  ) {
    return yield* writeThumbnail(
      "updateThumbnail",
      thumbnailId,
      (existing) => ({
        layers: params.layers,
        filePath: params.filePath,
        thumbnailDiagram: params.thumbnailDiagram,
        diagramSearchText: diagramSearchTextOf(params.thumbnailDiagram),
        diagramSources: mergeThumbnailDiagramSources(
          existing.diagramSources,
          params.diagramSources
        ),
      })
    );
  });

  /**
   * Adds insert sources to a Thumbnail and writes nothing else: the page
   * sends these alone as it goes away, when a whole save (its PNGs) is too
   * big to outlive it (ADR 0060: a link is never lost).
   */
  const recordThumbnailDiagramSources = Effect.fn(
    "recordThumbnailDiagramSources"
  )(function* (
    thumbnailId: string,
    diagramSources: readonly ThumbnailDiagramSource[]
  ) {
    return yield* writeThumbnail(
      "recordThumbnailDiagramSources",
      thumbnailId,
      (existing) => ({
        diagramSources: mergeThumbnailDiagramSources(
          existing.diagramSources,
          diagramSources
        ),
      })
    );
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
    return yield* writeThumbnail("archiveThumbnail", thumbnailId, () => ({
      archivedAt: sql`COALESCE(${thumbnails.archivedAt}, now())`,
    }));
  });

  /**
   * Thumbnail Diagrams whose text or Video title matches `query`, newest
   * first, with the same query language as `searchDiagrams`. Archived
   * Thumbnails, and old pasted-PNG ones (no Thumbnail Diagram), are left out.
   * A Version copy's unchanged drawing is one hit, the copy's
   * (`collapseVersionCopies`); any other two equal drawings are two.
   */
  const searchThumbnailDiagrams = Effect.fn("searchThumbnailDiagrams")(
    function* (query: string) {
      const tsQuery = sql`websearch_to_tsquery('english', ${query})`;
      const rows = yield* makeDbCall(() =>
        db
          .select({
            thumbnailId: thumbnails.id,
            videoId: videos.id,
            videoTitle: videos.title,
            searchText: thumbnails.diagramSearchText,
            sortKey: thumbnails.createdAt,
            lineageId: videos.lineageId,
            contentHash: sql<string>`md5(${thumbnails.thumbnailDiagram}::text)`,
            diagramSources: thumbnails.diagramSources,
          })
          .from(thumbnails)
          .innerJoin(videos, eq(thumbnails.videoId, videos.id))
          .where(
            and(
              isNull(thumbnails.archivedAt),
              isNotNull(thumbnails.thumbnailDiagram),
              or(
                sql`to_tsvector('english', coalesce(${thumbnails.diagramSearchText}, '') || ' ' || ${videos.title}) @@ ${tsQuery}`,
                ilike(videos.title, `%${escapeLike(query)}%`)
              )
            )
          )
          .orderBy(desc(thumbnails.createdAt), desc(thumbnails.id))
      );
      return collapseVersionCopies(rows).map(
        (row): ThumbnailDiagramSearchRow => ({
          source: "thumbnail-diagram",
          thumbnailId: row.thumbnailId,
          videoId: row.videoId,
          videoTitle: row.videoTitle,
          searchText: row.searchText,
          sortKey: row.sortKey,
        })
      );
    }
  );

  return {
    getThumbnailsByVideoId,
    searchThumbnailDiagrams,
    createThumbnail,
    getThumbnailById,
    updateThumbnail,
    recordThumbnailDiagramSources,
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
