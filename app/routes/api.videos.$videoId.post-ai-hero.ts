import { CoursePublishService } from "@/services/course-publish-service";
import { postToAiHero } from "@/services/ai-hero-upload-service";
import { runtimeLive } from "@/services/layer.server";
import { createSSEResponse } from "@/lib/create-sse-response.server";
import { Effect } from "effect";
import type { Route } from "./+types/api.videos.$videoId.post-ai-hero";

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;
  const body = await args.request.json();
  const title: string =
    typeof body.title === "string" ? body.title.trim() : body.title;
  const postBody: string = body.body;
  const description: string =
    typeof body.description === "string"
      ? body.description.trim()
      : body.description;
  const slug: string = body.slug ?? "";

  if (!title) {
    return Response.json({ error: "Title is required" }, { status: 400 });
  }

  return createSSEResponse({
    runtime: runtimeLive,
    program: (sendEvent) =>
      Effect.gen(function* () {
        const publishService = yield* CoursePublishService;
        const filePath = yield* publishService.resolveExportPath(videoId);

        if (!filePath) {
          sendEvent("error", { message: "Video has not been exported" });
          return;
        }

        const result = yield* postToAiHero({
          filePath,
          title,
          body: postBody ?? "",
          description: description ?? "",
          slug: slug ?? "",
          onProgress: (percentage) => {
            sendEvent("progress", { percentage });
          },
        });

        sendEvent("complete", { slug: result.slug });
      }),
    errorHandlers: [
      {
        tag: "AiHeroNotAuthenticatedError",
        handler: (_, sendEvent) => {
          sendEvent("error", { message: "Not authenticated with AI Hero" });
        },
      },
      {
        tag: "AiHeroUploadError",
        handler: (e, sendEvent) => {
          sendEvent("error", { message: e.message });
        },
      },
    ],
    fallbackMessage: "AI Hero post failed unexpectedly",
  });
};
