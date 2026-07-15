import { Effect } from "effect";
import { runtimeLive } from "@/services/layer.server";
import type { Route } from "./+types/api.videos.$videoId.render-vertical-sse";
import { RenderVerticalVideoService } from "@/services/render-vertical-video-service";
import { createSSEResponse } from "@/lib/create-sse-response.server";

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const renderService = yield* RenderVerticalVideoService;

        yield* renderService.renderVerticalVideo({
          videoId,
          onStageChange: (stage) => {
            sendEvent("stage", { stage });
          },
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
      {
        tag: "RenderVerticalError",
        handler: (e, sendEvent) => {
          sendEvent("error", { message: e.message });
        },
      },
    ],
    fallbackMessage: "Export vertical failed unexpectedly",
  });
};
