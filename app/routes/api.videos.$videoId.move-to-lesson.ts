import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { makeAction } from "@/services/route-action.server";

const moveVideoSchema = Schema.Struct({
  lessonId: Schema.String.pipe(
    Schema.minLength(1, { message: () => "Lesson ID is required" })
  ),
});

export const action = makeAction({
  input: "formData",
  effect: ({ params, payload }) =>
    Effect.gen(function* () {
      const { lessonId } =
        yield* Schema.decodeUnknown(moveVideoSchema)(payload);

      const videoOps = yield* VideoOperationsService;

      yield* videoOps.updateVideoLesson({
        videoId: params.videoId!,
        lessonId,
      });

      return { success: true };
    }),
});
