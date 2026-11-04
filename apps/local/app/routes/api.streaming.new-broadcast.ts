import { Effect, Schema } from "effect";
import { createNewBroadcast } from "@/services/new-broadcast.server";
import { makeAction } from "@/services/route-action.server";
import { repoEnvPath } from "@/services/repo-env";

const newBroadcastSchema = Schema.Struct({
  title: Schema.String,
  description: Schema.String,
  privacyStatus: Schema.Literal("public", "unlisted"),
  latencyPreference: Schema.Literal("normal", "low", "ultraLow"),
});

/**
 * NEW BROADCAST: creates a Broadcast on YouTube from the Streaming tab's
 * form, turns its monetization off and binds it to the Stream Key's stream
 * (`createNewBroadcast`). Answers the Broadcast and how each step went;
 * only a refused insert is an error.
 */
export const action = makeAction({
  input: "json",
  errors: { YouTubeLiveError: 502 },
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const settings = yield* Schema.decodeUnknown(newBroadcastSchema)(payload);
      return yield* createNewBroadcast({
        settings,
        submittedAt: new Date(),
        envPath: repoEnvPath(),
      });
    }),
});
