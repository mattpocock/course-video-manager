import { type Database } from "@/services/drizzle-service.server";
import { videos } from "@/db/schema";
import {
  NotFoundError,
  UnknownDBServiceError,
  VideoPathTakenError,
} from "@/services/db-service-errors";
import { and, eq, ne } from "drizzle-orm";
import { Effect } from "effect";

const makeDbCall = <T>(fn: () => Promise<T>) =>
  Effect.tryPromise({
    try: fn,
    catch: (e) => new UnknownDBServiceError({ cause: e }),
  });

/**
 * The Video WRITE verbs added for the `cvm` CLI, split out of
 * db-video-operations.server.ts to keep that file under the repo's per-file
 * token budget (see db-video-operations.copy.server.ts for the same pattern).
 * These are spread into VideoOperationsService's returned object, so callers
 * see them as ordinary service methods.
 */
export const createVideoWriteOps = (db: Database) => {
  /**
   * Fetch a single Video row (no relations) by id, failing NotFoundError when
   * absent. Used by the CLI write verbs to echo the affected row.
   */
  const getVideoRowById = Effect.fn("getVideoRowById")(function* (id: string) {
    const video = yield* makeDbCall(() =>
      db.query.videos.findFirst({ where: eq(videos.id, id) })
    );

    if (!video) {
      return yield* new NotFoundError({
        type: "getVideoRowById",
        params: { id },
      });
    }

    return video;
  });

  /**
   * Link a Video to a Pitch, enforcing the single-parent invariant: setting a
   * pitch parent also clears any lesson parent (a Pitch packages Standalone
   * videos, so a pitch-bound video is never lesson-bound). Returns the updated
   * row; NotFoundError when the video id is absent.
   */
  const linkVideoToPitch = Effect.fn("linkVideoToPitch")(function* (opts: {
    videoId: string;
    pitchId: string;
  }) {
    const [updated] = yield* makeDbCall(() =>
      db
        .update(videos)
        .set({ pitchId: opts.pitchId, lessonId: null, updatedAt: new Date() })
        .where(eq(videos.id, opts.videoId))
        .returning()
    );

    if (!updated) {
      return yield* new NotFoundError({
        type: "linkVideoToPitch",
        params: { videoId: opts.videoId },
      });
    }

    return updated;
  });

  /**
   * Move a Video into a Lesson, enforcing the single-parent invariant: setting a
   * lesson parent also clears any pitch parent. Re-checks the (lessonId, path)
   * uniqueness guard (VideoPathTakenError) before mutating — unlike
   * updateVideoLesson, which does not. Returns the updated row; NotFoundError
   * when the video id is absent.
   */
  const moveVideoToLesson = Effect.fn("moveVideoToLesson")(function* (opts: {
    videoId: string;
    lessonId: string;
  }) {
    const current = yield* makeDbCall(() =>
      db.query.videos.findFirst({
        where: eq(videos.id, opts.videoId),
        columns: { path: true },
      })
    );

    if (!current) {
      return yield* new NotFoundError({
        type: "moveVideoToLesson",
        params: { videoId: opts.videoId },
      });
    }

    // (lessonId, path) must be free among the target lesson's active videos.
    const clash = yield* makeDbCall(() =>
      db.query.videos.findFirst({
        where: and(
          eq(videos.lessonId, opts.lessonId),
          eq(videos.path, current.path),
          eq(videos.archived, false),
          ne(videos.id, opts.videoId)
        ),
        columns: { id: true },
      })
    );

    if (clash) {
      return yield* new VideoPathTakenError({
        path: current.path,
        message: `Video name "${current.path}" is already taken in this lesson`,
      });
    }

    const [updated] = yield* makeDbCall(() =>
      db
        .update(videos)
        .set({ lessonId: opts.lessonId, pitchId: null, updatedAt: new Date() })
        .where(eq(videos.id, opts.videoId))
        .returning()
    );

    if (!updated) {
      return yield* new NotFoundError({
        type: "moveVideoToLesson",
        params: { videoId: opts.videoId },
      });
    }

    return updated;
  });

  return { getVideoRowById, linkVideoToPitch, moveVideoToLesson };
};
