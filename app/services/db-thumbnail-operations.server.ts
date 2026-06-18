import {
  DrizzleService,
  type DrizzleDB,
} from "@/services/drizzle-service.server";
import { thumbnails } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  makeDbCall,
  dbQueryFirst,
  dbMutateReturning,
} from "@/services/db-query-primitives.server";

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
    return yield* dbMutateReturning(() =>
      db
        .insert(thumbnails)
        .values({
          videoId: params.videoId,
          layers: params.layers,
          filePath: params.filePath,
        })
        .returning()
    );
  });

  const getThumbnailById = Effect.fn("getThumbnailById")(function* (
    thumbnailId: string
  ) {
    return yield* dbQueryFirst(
      () =>
        db.query.thumbnails.findFirst({
          where: eq(thumbnails.id, thumbnailId),
        }),
      { type: "getThumbnailById", params: { thumbnailId } }
    );
  });

  const updateThumbnail = Effect.fn("updateThumbnail")(function* (
    thumbnailId: string,
    params: {
      layers: unknown;
      filePath: string | null;
    }
  ) {
    return yield* dbMutateReturning(
      () =>
        db
          .update(thumbnails)
          .set({
            layers: params.layers,
            filePath: params.filePath,
          })
          .where(eq(thumbnails.id, thumbnailId))
          .returning(),
      { type: "updateThumbnail", params: { thumbnailId } }
    );
  });

  const deleteThumbnail = Effect.fn("deleteThumbnail")(function* (
    thumbnailId: string
  ) {
    return yield* dbMutateReturning(
      () =>
        db.delete(thumbnails).where(eq(thumbnails.id, thumbnailId)).returning(),
      { type: "deleteThumbnail", params: { thumbnailId } }
    );
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
