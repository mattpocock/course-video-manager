import {
  DrizzleService,
  type Database,
} from "@/services/drizzle-service.server";
import { videoPosts } from "@/db/schema";
import { UnknownDBServiceError } from "@/services/db-service-errors";
import { eq } from "drizzle-orm";
import { Effect } from "effect";

export type VideoPostPlatform = "youtube-shorts" | "buffer";

const makeDbCall = <T>(fn: () => Promise<T>) => {
  return Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });
};

export const createVideoPostOperations = (db: Database) => {
  const createVideoPost = Effect.fn("createVideoPost")(function* (opts: {
    videoId: string;
    platform: VideoPostPlatform;
  }) {
    const results = yield* makeDbCall(() =>
      db
        .insert(videoPosts)
        .values({
          videoId: opts.videoId,
          platform: opts.platform,
        })
        .returning()
    );
    return results[0]!;
  });

  const listByVideoId = Effect.fn("listByVideoId")(function* (videoId: string) {
    return yield* makeDbCall(() =>
      db.query.videoPosts.findMany({
        where: eq(videoPosts.videoId, videoId),
      })
    );
  });

  const updateRemoteInfo = Effect.fn("updateRemoteInfo")(function* (opts: {
    id: string;
    remoteId: string;
    remoteUrl: string | null;
  }) {
    const results = yield* makeDbCall(() =>
      db
        .update(videoPosts)
        .set({
          remoteId: opts.remoteId,
          remoteUrl: opts.remoteUrl,
        })
        .where(eq(videoPosts.id, opts.id))
        .returning()
    );
    return results[0]!;
  });

  const markPosted = Effect.fn("markPosted")(function* (id: string) {
    const results = yield* makeDbCall(() =>
      db
        .update(videoPosts)
        .set({ postedAt: new Date() })
        .where(eq(videoPosts.id, id))
        .returning()
    );
    return results[0]!;
  });

  return {
    createVideoPost,
    listByVideoId,
    updateRemoteInfo,
    markPosted,
  };
};

export class VideoPostOperationsService extends Effect.Service<VideoPostOperationsService>()(
  "VideoPostOperationsService",
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleService;
      return createVideoPostOperations(db);
    }),
    dependencies: [],
  }
) {}
