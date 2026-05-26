import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";

const renameVideoSchema = Schema.Struct({
  name: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Video name cannot be empty" })
  ),
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { name } = yield* Schema.decodeUnknown(renameVideoSchema)(payload);

      const videoOps = yield* VideoOperationsService;

      yield* videoOps.updateVideoPath({
        videoId: params.videoId!,
        path: name.trim(),
      });

      return { success: true };
    }),
});
