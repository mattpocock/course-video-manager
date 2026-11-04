import { Effect, Either } from "effect";
import type {
  BindResult,
  Broadcast,
  NewBroadcastAnswer,
  NewBroadcastSettings,
} from "@/features/streaming/broadcast";
import { bindBroadcast, findKeysStream } from "@/services/youtube-live-service";
import {
  createBroadcast,
  turnMonetizationOff,
} from "@/services/youtube-live-broadcast-writes";
import { readStreamKey } from "@/services/stream-key.server";
import {
  NO_MATCHING_STREAM,
  RECONNECT_GOOGLE,
} from "@/services/recorder-client/go-live.server";

/**
 * NEW BROADCAST on the app server (spec #2677): creates the Broadcast on
 * YouTube, then, in order, turns its ads monetization off and binds it to
 * the Stream Key's stream. Only a failed insert fails it; each later step
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

export const createNewBroadcast = Effect.fn("createNewBroadcast")(
  function* (o: {
    settings: NewBroadcastSettings;
    /** When Matt submitted the form: the Broadcast is scheduled 5 minutes later. */
    submittedAt: Date;
    /** The `.env` the Stream Key is read from: `repoEnvPath()`. */
    envPath: string | undefined;
  }) {
    const inserted = yield* createBroadcast(o.settings, o.submittedAt);
    if (inserted.status === "needs-reconnect") return inserted;
    const monetization = yield* turnMonetizationOff(inserted.broadcast.id);
    const { broadcast, bind } = yield* bindToKeysStream(
      inserted.broadcast,
      o.envPath
    );
    const answer: NewBroadcastAnswer = {
      status: "created",
      broadcast,
      monetization,
      bind,
    };
    return answer;
  }
);
