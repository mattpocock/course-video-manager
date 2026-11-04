import { Effect, Schema } from "effect";
import { createNewBroadcast } from "@/services/new-broadcast.server";
import { makeAction } from "@/services/route-action.server";
import { repoEnvPath } from "@/services/repo-env";

const newBroadcastSchema = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  privacyStatus: Schema.Literal("public", "unlisted"),
  latencyPreference: Schema.Literal("normal", "low", "ultraLow"),
  /** The CVM Video the Streaming tab is open for: its thumbnails. */
  videoId: Schema.String,
  /** One of the Video's thumbnails to set on the Broadcast, or null. */
  thumbnailId: Schema.NullOr(Schema.String),
});

/**
 * NEW BROADCAST: creates a Broadcast on YouTube from the Streaming tab's
 * form, turns its monetization off, binds it to the Stream Key's stream
 * and sets the picked thumbnail (`createNewBroadcast`). Answers the Broadcast and how each step went;
 * only a refused insert is an error.
 */
export const action = makeAction({
  input: "json",
  errors: { YouTubeLiveError: 502 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const { videoId, thumbnailId, ...settings } =
        yield* Schema.decodeUnknown(newBroadcastSchema)(payload);
      return yield* createNewBroadcast({
        settings,
        submittedAt: new Date(),
        envPath: repoEnvPath(),
        thumbnail: thumbnailId === null ? null : { videoId, thumbnailId },
      });
    }),
});
