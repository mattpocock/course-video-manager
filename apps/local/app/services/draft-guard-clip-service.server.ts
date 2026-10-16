import { clips, courseVersions, lessons, sections, videos } from "@/db/schema";
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
import { MIC_OFFSET_SHARED_WITH_FROZEN_VERSION_MESSAGE } from "@/services/recording-session-shared-message";
import { and, eq, ne } from "drizzle-orm";
import { Data, Effect } from "effect";
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
 * A mic offset change was refused: the Clip's Recording Session is shared by
 * a Clip in a Version that is not a Draft (issue #2010).
 */
export class MicOffsetSharedWithFrozenVersionError extends Data.TaggedError(
  "MicOffsetSharedWithFrozenVersionError"
)<{
  recordingSessionId: string;
  versionId: string;
}> {
  // Serialized as the 409 body; the editor matches on it to show the refusal
  // in the Mic Settings dialog.
  override get message() {
    return MIC_OFFSET_SHARED_WITH_FROZEN_VERSION_MESSAGE;
  }
}

/**
 * A Recording Session is not owned by one Version: every copy of its Clips (a
 * new Draft, a Course duplicate, a Video copy) points at the same row, and its
 * mic offset joins the Export Hash of all of them. Guarding the edited Clip's
 * own Version is not enough, so refuse the offset change while any Clip of
 * the Session is in a Version that is not a Draft. The owning Version rows
 * are locked FOR UPDATE, like the draft guard, so a Submit cannot straddle
 * the check. A Clip with no Session (OBS) passes; its handler refuses it.
 */
const requireRecordingSessionOnlyInDrafts = Effect.fn(
  "requireRecordingSessionOnlyInDrafts"
)(function* (db: Database, clipId: string) {
  const clip = yield* Effect.tryPromise({
    try: () =>
      db.query.clips.findFirst({
        where: eq(clips.id, clipId),
        columns: { recordingSessionId: true },
      }),
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });
  const recordingSessionId = clip?.recordingSessionId;
  if (!recordingSessionId) return;
  const [frozen] = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ id: courseVersions.id })
        .from(clips)
        .innerJoin(videos, eq(videos.id, clips.videoId))
        .innerJoin(lessons, eq(lessons.id, videos.lessonId))
        .innerJoin(sections, eq(sections.id, lessons.sectionId))
        .innerJoin(
          courseVersions,
          eq(courseVersions.id, sections.repoVersionId)
        )
        .where(
          and(
            eq(clips.recordingSessionId, recordingSessionId),
            ne(courseVersions.commitState, "draft")
          )
        )
        .limit(1)
        .for("update", { of: courseVersions }),
    catch: (cause) => new UnknownDBServiceError({ cause }),
  });
  if (frozen) {
    return yield* new MicOffsetSharedWithFrozenVersionError({
      recordingSessionId,
      versionId: frozen.id,
    });
  }
});

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
    case "update-clip-text":
    case "update-scene-override":
    case "reorder-clip":
      return yield* requireDraftVersionForClip(db, event.clipId);
    case "update-mic-offset":
      yield* requireDraftVersionForClip(db, event.clipId);
      return yield* requireRecordingSessionOnlyInDrafts(db, event.clipId);
    case "update-chapter":
    case "reorder-chapter":
      return yield* requireDraftVersionForChapter(db, event.chapterId);
    case "archive-chapters":
      return yield* requireDraftVersionForChapters(db, event.chapterIds);
    // A read, a Video created standalone, and the mic EQ (a setting, not
    // any one Version's content) have no owning Version to guard.
    case "get-timeline":
    case "get-footage-stats":
    case "create-video":
    case "update-mic-eq":
      return;
  }
});

/**
 * Guarded clip-service write events run inside one transaction: guard (with
 * its version-row lock) + dispatch, committed atomically (issue #1403).
 * Reads and standalone-video creation dispatch outside a transaction.
 */
export const withClipServiceWriteClosure = <A, E>(
  db: Database,
  event: ClipServiceEvent,
  run: (db: Database) => Effect.Effect<A, E>
): Effect.Effect<
  A,
  | E
  | VersionNotDraftError
  | MicOffsetSharedWithFrozenVersionError
  | UnknownDBServiceError
> => {
  switch (event.type) {
    case "create-video":
    case "get-timeline":
    case "get-footage-stats":
    case "update-mic-eq":
      return run(db);
    case "append-clips":
    case "create-chapter-at-insertion-point":
    case "create-chapter-at-position":
    case "create-effect-clip-at-position":
    case "autofill-chapters":
    case "create-video-from-selection":
    case "archive-clips":
    case "unarchive-clips":
    case "update-clips":
    case "update-pause":
    case "update-zoom":
    case "update-clip-text":
    case "update-scene-override":
    case "update-mic-offset":
    case "reorder-clip":
    case "update-chapter":
    case "reorder-chapter":
    case "archive-chapters":
      return withDbTransaction(db, (tx) =>
        Effect.gen(function* () {
          yield* requireDraftForClipServiceEvent(tx, event);
          return yield* run(tx);
        })
      );
  }
};
