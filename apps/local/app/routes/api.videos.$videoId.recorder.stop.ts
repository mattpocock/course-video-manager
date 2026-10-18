import { Effect, Schema } from "effect";
import { InsertionPointSchema } from "@/services/clip-service.schemas";
import { recorderCommand } from "@/services/recorder-client/recorder-command";
import { recorderClient } from "@/services/recorder-client/live.server";
import { makeAction } from "@/services/route-action.server";

const schema = Schema.Struct({
  /**
   * The editor following this Recording Session is going away (New Short,
   * another page, a reload): its last Take goes at this Insertion Point.
   */
  editorLeft: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        recordingSessionId: Schema.String,
        insertionPoint: InsertionPointSchema,
      })
    )
  ),
});

/** Stop, on a CVM recorder Video: answers once the files are closed. */
export const action = makeAction({
  input: "json",
  errors: { RecorderCommandError: 409 },
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const { editorLeft } = yield* Schema.decodeUnknown(schema)(payload ?? {});
      yield* recorderCommand(() =>
        recorderClient().stopRecording(videoId, editorLeft ?? undefined)
      );
      return { ok: true };
    }),
});
