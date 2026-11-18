import { DrizzleService, type Database } from "./drizzle-service.server.js";
import { thumbnails } from "../db/schema.js";
import { NotFoundError, UnknownDBServiceError } from "./db-service-errors.js";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";

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
  }) {
    const [record] = yield* makeDbCall(() =>
      db
        .insert(thumbnails)
        .values({
          videoId: params.videoId,
          layers: params.layers,
          filePath: params.filePath,
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
    }
  ) {
    const [updated] = yield* makeDbCall(() =>
      db
        .update(thumbnails)
        .set({
          layers: params.layers,
          filePath: params.filePath,
        })
        .where(eq(thumbnails.id, thumbnailId))
        .returning()
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
