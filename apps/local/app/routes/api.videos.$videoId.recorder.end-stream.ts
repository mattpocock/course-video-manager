import { Effect, Schema } from "effect";
import { recorderClient } from "@/services/recorder-client/live.server";
import { endStream } from "@/services/recorder-client/go-live.server";
import { makeAction } from "@/services/route-action.server";

const endStreamSchema = Schema.Struct({
  /** Make the Broadcast Unlisted once it is complete (**Unlist When Ended**). */
  unlistWhenEnded: Schema.Boolean,
});

/**
 * End Stream (ADR 0054): the push and the streamed Recording Session stop
 * together, the last Take let go as Stop lets it go. The app server stops
 * reading the Broadcast's chat when it hears the streamed Recording Session
 * end (`live.server.ts`), as it does however it ends. With `unlistWhenEnded`
 * it then makes the Broadcast Unlisted, and answers how that went.
 */
export const action = makeAction({
  input: "json",
  errors: { RecorderCommandError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknown(endStreamSchema)(payload);
      const unlist = yield* endStream(recorderClient(), params.videoId!, {
        unlistWhenEnded: request.unlistWhenEnded,
      });
      return { ok: true, unlist };
    }),
});
