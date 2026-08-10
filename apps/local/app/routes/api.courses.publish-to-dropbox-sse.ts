import { CoursePublishService } from "@/services/course-publish-service";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import type { Route } from "./+types/api.courses.publish-to-dropbox-sse";
import { ConfigProvider, Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";

const publishRepoSchema = Schema.Struct({
  repoId: Schema.String,
  courseVersionId: Schema.optional(Schema.String),
  includeTodoLessons: Schema.optional(Schema.Boolean),
});

export const action = async ({ request }: Route.ActionArgs) => {
  const body = await request.json();

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknown(publishRepoSchema)(body);

        const publishService = yield* CoursePublishService;
        // Pending commits must retry the exact frozen Course Version with the
        // original to-do policy. Without an id, re-sync the latest frozen version.
        const { missingVideos } = result.courseVersionId
          ? yield* publishService.syncFrozenVersionToDropbox(
              result.repoId,
              result.courseVersionId,
              result.includeTodoLessons ?? true,
              sendEvent
            )
          : yield* publishService.syncToDropbox(
              result.repoId,
              result.includeTodoLessons ?? true,
              sendEvent
            );

        sendEvent("complete", {
          missingVideoCount: missingVideos.length,
        });
      }).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv())),
    errorHandlers: [
      {
        tag: "DropboxNotAuthenticatedError",
        handler: (_error, sendEvent) => {
          sendEvent("error", {
            message:
              "Dropbox is not connected. Connect your Dropbox account before publishing.",
          });
        },
      },
    ],
    fallbackMessage: "Publish failed unexpectedly",
  });
};
