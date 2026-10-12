import { Effect, Schema } from "effect";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

const schema = Schema.Struct({
  silenceLength: Schema.Literal("short", "long"),
});

/**
 * The editor's Silence Length, while the recorder is open for its Video: a
 * Record pressed on the Stream Deck records with it.
 */
export const action = makeAction({
  input: "json",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { silenceLength } = yield* Schema.decodeUnknown(schema)(payload);
      recorderClient().setSilenceLength(params.videoId!, silenceLength);
      return { ok: true };
    }),
});
