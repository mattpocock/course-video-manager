import { Effect } from "effect";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.videos.$videoId.export-sse";
import { CoursePublishService } from "@/services/course-publish-service";
import { createSSEResponse } from "@/lib/create-sse-response.server";

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const publishService = yield* CoursePublishService;

        yield* publishService.exportVideo(videoId, (stage) => {
          sendEvent("stage", { stage });
        });

        sendEvent("complete", {});
      }),
    errorHandlers: [
      {
        tag: "NotFoundError",
        handler: (_, sendEvent) => {
          sendEvent("error", { message: "Video not found" });
        },
      },
    ],
    fallbackMessage: "Export failed unexpectedly",
  });
};
