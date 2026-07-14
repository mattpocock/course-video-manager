import { Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.courses.$courseId.publish-sse";
import { CoursePublishService } from "@/services/course-publish-service";
import { createSSEResponse } from "@/lib/create-sse-response.server";

const publishSchema = Schema.Struct({
  name: Schema.String,
  // Required, like name: a Published Version always carries a description (it
  // feeds the changelog and the frozen snapshot). The publish page gates on a
  // non-empty value; this just refuses a payload that omits the field.
  description: Schema.String,
  includeTodoLessons: Schema.optional(Schema.Boolean),
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
          parsed.description,
          parsed.includeTodoLessons ?? true,
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
          const parts: string[] = [];
          if (e.unexportedVideoIds.length > 0) {
            parts.push(
              `${e.unexportedVideoIds.length} video(s) are not yet exported`
            );
          }
          if (e.courseViewLintCount && e.courseViewLintCount > 0) {
            parts.push(
              `${e.courseViewLintCount} course warning(s) must be fixed`
            );
          }
          sendEvent("error", {
            message: parts.join("; ") || "Publish validation failed",
            type: "validation",
            unexportedVideoIds: e.unexportedVideoIds,
            courseViewLintCount: e.courseViewLintCount ?? 0,
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
