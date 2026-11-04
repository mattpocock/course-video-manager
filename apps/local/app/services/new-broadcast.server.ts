import { Effect, Either } from "effect";
import { ThumbnailOperationsService } from "@/services/db-thumbnail-operations.server";
import { locateStoredVideoFile } from "@/services/video-files";
import type {
  BindResult,
  Broadcast,
  NewBroadcastAnswer,
  NewBroadcastSettings,
  ThumbnailResult,
} from "@/features/streaming/broadcast";
import { bindBroadcast, findKeysStream } from "@/services/youtube-live-service";
import {
  createBroadcast,
  setBroadcastThumbnail,
  turnMonetizationOff,
} from "@/services/youtube-live-broadcast-writes";
import { readStreamKey } from "@/services/stream-key.server";
import {
  NO_MATCHING_STREAM,
  RECONNECT_GOOGLE,
} from "@/services/recorder-client/go-live.server";

/**
 * NEW BROADCAST on the app server (spec #2677): creates the Broadcast on
 * YouTube, then, in order, turns its ads monetization off, binds it to
 * the Stream Key's stream and sets its thumbnail. Only a failed insert fails it; each later step
 * is answered, so the Broadcast is picked whatever they said.
 */

/**
 * Binds the new Broadcast to the Stream Key's stream, or says why not. The
 * reasons are Go Live's own: it refuses with them, and binds when it can
 * (`bindIfNeeded`).
 */
const bindToKeysStream = (broadcast: Broadcast, envPath: string | undefined) =>
  Effect.gen(function* () {
    const notBound = (reason: string) => ({
      broadcast,
      bind: { status: "not-bound", reason } as BindResult,
    });
    const streamKey = readStreamKey(envPath);
    if (Either.isLeft(streamKey)) return notBound(streamKey.left);
    const keys = yield* findKeysStream(streamKey.right);
    if (keys.status === "no-match") return notBound(NO_MATCHING_STREAM);
    if (keys.status === "needs-reconnect") return notBound(RECONNECT_GOOGLE);
    yield* bindBroadcast({
      broadcastId: broadcast.id,
      streamId: keys.streamId,
    });
    return {
      broadcast: { ...broadcast, boundStreamId: keys.streamId },
      bind: { status: "bound" } as BindResult,
    };
  }).pipe(
    Effect.catchTag("YouTubeLiveError", (e) =>
      Effect.succeed({
        broadcast,
        bind: {
          status: "not-bound",
          reason: `Could not bind the Broadcast to the Stream Key's stream: ${e.message}`,
        } as BindResult,
      })
    )
  );

/** One of a CVM Video's thumbnails, picked for a Broadcast. */
export type BroadcastThumbnail = { videoId: string; thumbnailId: string };

const thumbnailFailed = (reason: string): ThumbnailResult => ({
  status: "failed",
  reason,
});

/**
 * Sets a Broadcast's thumbnail to the image of one of the Video's
 * thumbnails: the row's `filePath`, the same file the YouTube post uploads.
 * At create, and later for a picked Broadcast, before or during the Live
 * Stream. Answered, never failed.
 */
export const setThumbnailOnBroadcast = Effect.fn("setThumbnailOnBroadcast")(
  function* (o: BroadcastThumbnail & { broadcastId: string }) {
    const thumbnails = yield* ThumbnailOperationsService;
    const found = yield* thumbnails.getThumbnailById(o.thumbnailId).pipe(
      Effect.catchTags({
        NotFoundError: () => Effect.succeed(null),
        UnknownDBServiceError: () => Effect.succeed("unreadable" as const),
      })
    );
    if (found === "unreadable") {
      return thumbnailFailed(
        "the thumbnail could not be read from the database: try again."
      );
    }
    const row = found;
    if (row === null || row.videoId !== o.videoId) {
      return thumbnailFailed("the thumbnail is not one of this Video's.");
    }
    if (!row.filePath) {
      return thumbnailFailed(
        "the thumbnail has no image yet: save it in the thumbnail creator."
      );
    }
    // Root-relative on whichever Storage Root has it (ADR 0040).
    return yield* setBroadcastThumbnail(
      o.broadcastId,
      locateStoredVideoFile(row.filePath) ?? row.filePath
    );
  }
);

export const createNewBroadcast = Effect.fn("createNewBroadcast")(
  function* (o: {
    settings: NewBroadcastSettings;
    /** When Matt submitted the form: the Broadcast is scheduled 5 minutes later. */
    submittedAt: Date;
    /** The `.env` the Stream Key is read from: `repoEnvPath()`. */
    envPath: string | undefined;
    /** The Video's thumbnail to set on it, or null for none. */
    thumbnail: BroadcastThumbnail | null;
  }) {
    const inserted = yield* createBroadcast(o.settings, o.submittedAt);
    if (inserted.status === "needs-reconnect") return inserted;
    const monetization = yield* turnMonetizationOff(inserted.broadcast.id);
    const { broadcast, bind } = yield* bindToKeysStream(
      inserted.broadcast,
      o.envPath
    );
    const thumbnail: ThumbnailResult =
      o.thumbnail === null
        ? { status: "none" }
        : yield* setThumbnailOnBroadcast({
            broadcastId: broadcast.id,
            ...o.thumbnail,
          });
    const answer: NewBroadcastAnswer = {
      status: "created",
      broadcast,
      monetization,
      bind,
      thumbnail,
    };
    return answer;
  }
);
