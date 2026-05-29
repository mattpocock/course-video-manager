import { Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.courses.$courseId.publish-sse";
import { CoursePublishService } from "@/services/course-publish-service";
import { createSSEResponse } from "@/lib/create-sse-response.server";

const publishSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
});

export const action = async (args: Route.ActionArgs) => {
  const { courseId } = args.params;
  const body = await args.request.json();
  const parsed = Schema.decodeUnknownSync(publishSchema)(body);

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const publishService = yield* CoursePublishService;

        const result = yield* publishService.publish(
          courseId,
          parsed.name,
          parsed.description ?? "",
          (stage) => {
            sendEvent("progress", { stage });
          }
        );

        sendEvent("complete", {
          publishedVersionId: result.publishedVersionId,
          newDraftVersionId: result.newDraftVersionId,
        });
      }),
    errorHandlers: [
      {
        tag: "PublishValidationError",
        handler: (e, sendEvent) => {
          sendEvent("error", {
            message: `${e.unexportedVideoIds.length} video(s) are not yet exported`,
            type: "validation",
            unexportedVideoIds: e.unexportedVideoIds,
          });
        },
      },
      {
        tag: "NotFoundError",
        handler: (_, sendEvent) => {
          sendEvent("error", { message: "Course not found" });
        },
      },
    ],
    fallbackMessage: "Publish failed unexpectedly",
  });
};
