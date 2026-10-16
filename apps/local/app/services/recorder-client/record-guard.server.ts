import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { videos } from "@/db/schema";
import { resolveVideoFormat } from "@/features/videos/video-format";
import { NotFoundError } from "@/services/db-service-errors";
import { dbCall } from "@/services/clip-service-handler.helpers";
import { requireDraftVersionForVideo } from "@/services/draft-guard.server";
import type { Database } from "@/services/drizzle-service.server";
import { withDbTransaction } from "@/services/with-db-transaction.server";

/**
 * Whether Record may start on a Video: its Version is the Draft (a Recording Session hangs off the Video, so the
 * Draft guard is its guard too; docs/DRAFT_GUARD.md). Answers the Video's
 * format, which the recorder records in.
 */
export const requireRecordableVideo = Effect.fn("requireRecordableVideo")(
  function* (db: Database, videoId: string) {
    const video = yield* dbCall(() =>
      db.query.videos.findFirst({
        where: eq(videos.id, videoId),
        columns: { id: true, format: true },
      })
    );
    if (!video)
      return yield* new NotFoundError({ type: "video", params: { videoId } });
    yield* withDbTransaction(db, (tx) =>
      requireDraftVersionForVideo(tx, videoId)
    );
    return { format: resolveVideoFormat(video.format) };
  }
);
