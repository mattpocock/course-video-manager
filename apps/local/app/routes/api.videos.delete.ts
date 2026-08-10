import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";

const deleteVideoSchema = Schema.Struct({
  videoId: Schema.String,
});

export const action = makeAction({
  input: "formData",
  effect: ({ payload }) =>
    Effect.gen(function* () {
      const { videoId } =
        yield* Schema.decodeUnknown(deleteVideoSchema)(payload);

      const videoOps = yield* VideoOperationsService;

      yield* videoOps.deleteVideo(videoId);

      return { success: true };
    }),
});
