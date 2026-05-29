import { CoursePublishService } from "@/services/course-publish-service";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import type { Route } from "./+types/api.courses.publish-to-dropbox-sse";
import { ConfigProvider, Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";

const publishRepoSchema = Schema.Struct({
  repoId: Schema.String,
});

export const action = async ({ request }: Route.ActionArgs) => {
  const body = await request.json();

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const result = yield* Schema.decodeUnknown(publishRepoSchema)(body);

        const publishService = yield* CoursePublishService;
        const { missingVideos } = yield* publishService.syncToDropbox(
          result.repoId,
          sendEvent
        );

        sendEvent("complete", {
          missingVideoCount: missingVideos.length,
        });
      }).pipe(Effect.withConfigProvider(ConfigProvider.fromEnv())),
    fallbackMessage: "Publish failed unexpectedly",
  });
};
