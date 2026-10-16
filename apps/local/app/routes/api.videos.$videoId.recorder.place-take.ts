import { Effect, Schema } from "effect";
import { InsertionPointSchema } from "@/services/clip-service.schemas";
import { recorderClient } from "@/services/recorder-client/live.server";
import { recorderCommand } from "@/services/recorder-client/recorder-command";
import { makeAction } from "@/services/route-action.server";

const schema = Schema.Struct({
  recordingSessionId: Schema.String,
  insertionPoint: InsertionPointSchema,
});

/**
 * The editor heard a CVM recorder speech end: save it here (its insertion
 * point), and answer with the Clips saved.
 */
export const action = makeAction({
  input: "json",
  errors: { RecorderCommandError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { recordingSessionId, insertionPoint } =
        yield* Schema.decodeUnknown(schema)(payload);
      return yield* recorderCommand(() =>
        recorderClient().placeTake(
          params.videoId!,
          recordingSessionId,
          insertionPoint
        )
      );
    }),
});
