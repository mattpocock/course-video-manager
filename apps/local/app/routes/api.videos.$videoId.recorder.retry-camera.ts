import { Effect } from "effect";
import { recorderCommand } from "@/services/recorder-client/client.server";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

/** Retry, after the Cam Link did not start or OBS held it: tries it again. */
export const action = makeAction({
  input: "none",
  errors: { RecorderCommandError: 409 },
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      yield* recorderCommand(() => recorderClient().retryCamera(videoId));
      return { ok: true };
    }),
});
