import { Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";
import { CoursePublishService } from "@/services/course-publish-service";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import type { Route } from "./+types/api.courseVersions.$versionId.batch-export-sse";

const batchExportSchema = Schema.Struct({
  includeTodoLessons: Schema.optional(Schema.Boolean),
});

export const action = async (args: Route.ActionArgs) => {
  const { versionId } = args.params;
  const body = await args.request.json().catch(() => ({}));
  const parsed = Schema.decodeUnknownSync(batchExportSchema)(body);
  // Default to include — Export All ships everything unless to-do Lessons are
  // being withheld on the publish page.
  const includeTodoLessons = parsed.includeTodoLessons ?? true;

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const publishService = yield* CoursePublishService;
        yield* publishService.batchExport(versionId, includeTodoLessons, (e) =>
          sendEvent(e.event, e.data)
        );
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
