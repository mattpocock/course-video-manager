import { Effect, Schema } from "effect";
import {
  recorderClient,
  recordingFolder,
} from "@/services/recorder-client/live.server";
import { goLive } from "@/services/recorder-client/go-live.server";
import { DrizzleService } from "@/services/drizzle-service.server";
import { makeAction } from "@/services/route-action.server";
import { repoEnvPath } from "@/services/repo-env";

const goLiveSchema = Schema.Struct({
  /** The Broadcast picked on the Streaming tab; null: none picked. */
  broadcastId: Schema.NullOr(Schema.String),
  silenceLength: Schema.Literal("short", "long"),
});

/**
 * Go Live (ADR 0054): a streamed Recording Session and its Live Stream,
 * started together. Answers once it records; a refusal is a 409 naming every
 * reason that applies, never the Stream Key.
 */
export const action = makeAction({
  input: "json",
  errors: {
    GoLiveRefusedError: 409,
    RecorderCommandError: 409,
    VersionNotDraftError: 409,
  },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknown(goLiveSchema)(payload);
      const db = yield* DrizzleService;
      yield* goLive({
        db,
        client: recorderClient(),
        videoId: params.videoId!,
        broadcastId: request.broadcastId,
        silenceLength: request.silenceLength,
        folder: recordingFolder(),
        envPath: repoEnvPath(),
        now: new Date(),
      });
      return { ok: true };
    }),
});
