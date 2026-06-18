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
    errors: { NotFoundError: 404, VideoPathTakenError: 409 },
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

        // The article-writer "add video to next lesson" flow explicitly opts
        // into navigating to the write page. Every other caller (e.g. the
        // course-view Add Video modal) stays put — the new video shows up via
        // loader revalidation, with no redirect into the editor.
        const url = new URL(args.request.url);
        if (url.searchParams.get("redirectTo") === "write") {
          return redirect(`/videos/${video.id}/write`);
        }
        return { videoId: video.id };
      }),
  })(args);
};
