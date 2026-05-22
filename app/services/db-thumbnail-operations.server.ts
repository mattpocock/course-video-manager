import {
  DrizzleService,
  type DrizzleDB,
} from "@/services/drizzle-service.server";
import { thumbnails } from "@/db/schema";
import {
  NotFoundError,
  UnknownDBServiceError,
} from "@/services/db-service-errors";
import { desc, eq } from "drizzle-orm";
import { Effect } from "effect";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createThumbnailOperations = (db: DrizzleDB) => {
  const getThumbnailsByVideoId = Effect.fn("getThumbnailsByVideoId")(function* (
    videoId: string
  ) {
    return yield* makeDbCall(() =>
      db.query.thumbnails.findMany({
        where: eq(thumbnails.videoId, videoId),
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

  const deleteThumbnail = Effect.fn("deleteThumbnail")(function* (
    thumbnailId: string
  ) {
    const [deleted] = yield* makeDbCall(() =>
      db.delete(thumbnails).where(eq(thumbnails.id, thumbnailId)).returning()
    );

    if (!deleted) {
      return yield* new NotFoundError({
        type: "deleteThumbnail",
        params: { thumbnailId },
      });
    }

    return deleted;
  });

  return {
    getThumbnailsByVideoId,
    createThumbnail,
    getThumbnailById,
    updateThumbnail,
    deleteThumbnail,
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
