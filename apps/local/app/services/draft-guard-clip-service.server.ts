import type { Database } from "@/services/drizzle-service.server";
import {
  UnknownDBServiceError,
  VersionNotDraftError,
} from "@/services/db-service-errors";
import { withDbTransaction } from "@/services/with-db-transaction.server";
import {
  requireDraftVersionForChapter,
  requireDraftVersionForChapters,
  requireDraftVersionForClip,
  requireDraftVersionForClips,
  requireDraftVersionForVideo,
} from "@/services/draft-guard.server";
import { Effect } from "effect";
import type { ClipServiceEvent } from "@/services/clip-service";

/**
 * The clip-service half of the draft guard.
 *
 * The guards themselves are domain rules and live in `@cvm/core` with the
 * operations they protect. These two do not: they are keyed on
 * `ClipServiceEvent`, the wire shape of the browser's clip-service endpoint,
 * which belongs to the Video Editor and reaches into the AI-facing Autofill
 * input types. Splitting them out is what keeps the core package free of the
 * application it serves.
 */

/**
 * Write-closure for the clip-service handler, which writes to the DB directly
 * instead of going through the guarded ops services: resolve a write event's
 * target and refuse it when the owning CourseVersion is not a Draft. Read
 * events and events that only create standalone videos pass straight through.
 */
export const requireDraftForClipServiceEvent = Effect.fn(
  "requireDraftForClipServiceEvent"
)(function* (db: Database, event: ClipServiceEvent) {
  switch (event.type) {
    case "append-clips":
    case "append-from-obs":
    case "create-chapter-at-insertion-point":
    case "create-chapter-at-position":
    case "create-effect-clip-at-position":
    case "autofill-chapters":
      return yield* requireDraftVersionForVideo(db, event.input.videoId);
    case "create-video-from-selection":
      // Copies always join the source video's lesson (and thus its version);
      // move mode additionally archives the source clips.
      return yield* requireDraftVersionForVideo(db, event.input.sourceVideoId);
    case "archive-clips":
    case "unarchive-clips":
      // Guard every distinct owning video — a mixed-version batch must not
      // slip past a first-element check (in practice a batch targets one).
      return yield* requireDraftVersionForClips(db, event.clipIds);
    case "update-clips":
      return yield* requireDraftVersionForClips(
        db,
        event.clips.map((c) => c.id)
      );
    case "update-pause":
    case "update-zoom":
    case "reorder-clip":
      return yield* requireDraftVersionForClip(db, event.clipId);
    case "update-chapter":
    case "reorder-chapter":
      return yield* requireDraftVersionForChapter(db, event.chapterId);
    case "archive-chapters":
      return yield* requireDraftVersionForChapters(db, event.chapterIds);
    default:
      return;
  }
});

/**
 * Guarded clip-service write events run inside one transaction: guard (with
 * its version-row lock) + dispatch, committed atomically (issue #1403).
 * Reads, standalone-video creation, and append-from-obs (which re-guards
 * around its insert AFTER the slow OBS detection — see appendFromObsImpl)
 * dispatch outside a transaction.
 */
export const withClipServiceWriteClosure = <A, E>(
  db: Database,
  event: ClipServiceEvent,
  run: (db: Database) => Effect.Effect<A, E>
): Effect.Effect<A, E | VersionNotDraftError | UnknownDBServiceError> => {
  switch (event.type) {
    case "create-video":
    case "get-timeline":
    case "append-from-obs":
      return run(db);
    default:
      return withDbTransaction(db, (tx) =>
        Effect.gen(function* () {
          yield* requireDraftForClipServiceEvent(tx, event);
          return yield* run(tx);
        })
      );
  }
};
