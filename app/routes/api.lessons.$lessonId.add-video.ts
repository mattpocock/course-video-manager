import { Effect, Schema } from "effect";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { LessonSectionOperationsService } from "@/services/db-lesson-section-operations.server";
import { makeAction } from "@/services/route-action.server";
import { redirect } from "react-router";
import type { Route } from "./+types/api.lessons.$lessonId.add-video";

const addVideoSchema = Schema.Struct({
  path: Schema.String,
});

export const action = async (args: Route.ActionArgs) => {
  return makeAction({
    input: "formData",
    errors: { NotFoundError: 404 },
    effect: ({ params, payload }) =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknown(addVideoSchema)(payload);

        const videoOps = yield* VideoOperationsService;
        const lessonSectionOps = yield* LessonSectionOperationsService;
        yield* lessonSectionOps.getLessonById(params.lessonId!);

        const video = yield* videoOps.createVideo(params.lessonId!, {
          path: result.path,
          originalFootagePath: "",
        });

        const url = new URL(args.request.url);
        const redirectTo =
          url.searchParams.get("redirectTo") === "write" ? "write" : "edit";
        return redirect(`/videos/${video.id}/${redirectTo}`);
      }),
  })(args);
};
