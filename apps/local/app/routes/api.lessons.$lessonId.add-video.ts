import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { makeAction } from "@/services/route-action.server";
import type { Route } from "./+types/api.lessons.$lessonId.add-video";

const addVideoSchema = Schema.Struct({
  title: Schema.String,
});

export const action = async (args: Route.ActionArgs) => {
  return makeAction({
    input: "formData",
    errors: { NotFoundError: 404, VideoTitleTakenError: 409 },
    effect: ({ params, payload }) =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknown(addVideoSchema)(payload);

        const videoOps = yield* VideoOperationsService;
        const lessonSectionOps = yield* LessonSectionOperationsService;
        yield* lessonSectionOps.getLessonById(params.lessonId!);

        const video = yield* videoOps.createVideo(params.lessonId!, {
          title: result.title,
          originalFootagePath: "",
        });

        return { videoId: video.id };
      }),
  })(args);
};
