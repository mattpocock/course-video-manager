import { Effect } from "effect";
import { runtimeLive } from "@/services/layer.server";
import { CoursePublishService } from "@/services/course-publish-service";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import type { Route } from "./+types/api.courseVersions.$versionId.batch-export-sse";

export const action = async (args: Route.ActionArgs) => {
  const { versionId } = args.params;

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const publishService = yield* CoursePublishService;
        yield* publishService.batchExport(versionId, sendEvent);
      }),
    errorHandlers: [
      {
        tag: "NotFoundError",
        handler: (_, sendEvent) => {
          sendEvent("error", {
            videoId: null,
            message: "Version not found",
          });
        },
      },
    ],
    fallbackMessage: "Batch export failed unexpectedly",
  });
};
