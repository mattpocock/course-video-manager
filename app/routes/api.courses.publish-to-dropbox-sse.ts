import { CoursePublishService } from "@/services/course-publish-service";
import type { Route } from "./+types/api.courses.publish-to-dropbox-sse";
import { ConfigProvider, Console, Effect, Schema } from "effect";
import { runtimeLive } from "@/services/layer.server";

const publishRepoSchema = Schema.Struct({
  repoId: Schema.String,
});

export const action = async ({ request }: Route.ActionArgs) => {
  const body = await request.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      const program = Effect.gen(function* () {
        const result = yield* Schema.decodeUnknown(publishRepoSchema)(body);

        const publishService = yield* CoursePublishService;
        const { missingVideos } = yield* publishService.syncToDropbox(
          result.repoId,
          sendEvent
        );

        sendEvent("complete", {
          missingVideoCount: missingVideos.length,
        });
      });

      program
        .pipe(
          Effect.tapErrorCause((e) => {
            return Console.log(e);
          }),
          Effect.catchAll((e) =>
            Effect.sync(() => {
              sendEvent("error", {
                message:
                  "message" in e && typeof e.message === "string"
                    ? e.message
                    : "Publish failed unexpectedly",
              });
            })
          ),
          Effect.withConfigProvider(ConfigProvider.fromEnv()),
          runtimeLive.runPromise
        )
        .finally(() => {
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
