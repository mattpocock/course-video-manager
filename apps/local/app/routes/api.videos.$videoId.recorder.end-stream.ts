import { Effect } from "effect";
import { recorderClient } from "@/services/recorder-client/live.server";
import { endStream } from "@/services/recorder-client/go-live.server";
import { makeAction } from "@/services/route-action.server";

/**
 * End Stream (ADR 0054): the push and the streamed Recording Session stop
 * together, the last Take let go as Stop lets it go.
 */
export const action = makeAction({
  input: "json",
  errors: { RecorderCommandError: 409 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      yield* endStream(recorderClient(), params.videoId!);
      return { ok: true };
    }),
});
