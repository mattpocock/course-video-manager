import { Data, Effect } from "effect";
import { eq } from "drizzle-orm";
import { resolveVideoRecorder } from "@cvm/core/features/videos/recorder";
import { videos } from "@/db/schema";
import { NotFoundError } from "@/services/db-service-errors";
import { dbCall } from "@/services/clip-service-handler.helpers";
import { requireDraftVersionForVideo } from "@/services/draft-guard.server";
import type { Database } from "@/services/drizzle-service.server";
import { withDbTransaction } from "@/services/with-db-transaction.server";

/** Record on a Video that records with OBS (a stale tab, say). */
export class RecordOnOBSVideoError extends Data.TaggedError(
  "RecordOnOBSVideoError"
)<{ readonly message: string }> {}

/**
 * Whether Record may start on a Video: it records with the New recorder, and
 * its Version is the Draft (a Recording Session hangs off the Video, so the
 * Draft guard is its guard too; docs/DRAFT_GUARD.md).
 */
export const requireRecordableVideo = Effect.fn("requireRecordableVideo")(
  function* (db: Database, videoId: string) {
    const video = yield* dbCall(() =>
      db.query.videos.findFirst({
        where: eq(videos.id, videoId),
        columns: { id: true, recorder: true },
      })
    );
    if (!video)
      return yield* new NotFoundError({ type: "video", params: { videoId } });
    if (resolveVideoRecorder(video.recorder) !== "new-recorder")
      return yield* new RecordOnOBSVideoError({
        message: "This Video records with OBS. Reload to see its Recorder.",
      });
    yield* withDbTransaction(db, (tx) =>
      requireDraftVersionForVideo(tx, videoId)
    );
  }
);
