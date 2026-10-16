import { Effect, Schema } from "effect";
import { DrizzleService } from "@/services/drizzle-service.server";
import { recorderClient } from "@/services/recorder-client/live.server";
import { requireRecordableVideo } from "@/services/recorder-client/record-guard.server";
import { makeAction } from "@/services/route-action.server";

const schema = Schema.Struct({
  silenceLength: Schema.Literal("short", "long"),
});

/**
 * The editor's Silence Length, while the recorder is open for its Video: a
 * Record pressed on the Stream Deck records with it. Only on a Video the
 * editor's Record may record on (the same 409s), so the Stream Deck cannot
 * record where the editor would refuse.
 */
export const action = makeAction({
  input: "json",
  errors: {
    VersionNotDraftError: 409,
  },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { silenceLength } = yield* Schema.decodeUnknown(schema)(payload);
      yield* requireRecordableVideo(yield* DrizzleService, params.videoId!);
      recorderClient().setSilenceLength(params.videoId!, silenceLength);
      return { ok: true };
    }),
});
