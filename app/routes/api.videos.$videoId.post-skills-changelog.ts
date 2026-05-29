import { CoursePublishService } from "@/services/course-publish-service";
import { postSkillsChangelogToAiHero } from "@/services/ai-hero-upload-service";
import { runtimeLive } from "@/services/layer.server";
import { Effect } from "effect";
import type { Route } from "./+types/api.videos.$videoId.post-skills-changelog";

export const action = async (args: Route.ActionArgs) => {
  const { videoId } = args.params;
  const body = await args.request.json();
  const title: string =
    typeof body.title === "string" ? body.title.trim() : body.title;
  const slug: string = body.slug ?? "";
  const postBody: string = body.body ?? "";
  const description: string =
    typeof body.description === "string"
      ? body.description.trim()
      : (body.description ?? "");
  const newsletterSubject: string =
    typeof body.newsletterSubject === "string"
      ? body.newsletterSubject.trim()
      : (body.newsletterSubject ?? "");
  const newsletterPreviewText: string =
    typeof body.newsletterPreviewText === "string"
      ? body.newsletterPreviewText.trim()
      : (body.newsletterPreviewText ?? "");
  const newsletterCopy: string = body.newsletterCopy ?? "";

  if (!title) {
    return Response.json({ error: "Title is required" }, { status: 400 });
  }
  if (!newsletterSubject || !newsletterCopy.trim()) {
    return Response.json(
      { error: "Newsletter subject and copy are required" },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      const program = Effect.gen(function* () {
        const publishService = yield* CoursePublishService;
        const filePath = yield* publishService.resolveExportPath(videoId);

        if (!filePath) {
          sendEvent("error", { message: "Video has not been exported" });
          return;
        }

        const result = yield* postSkillsChangelogToAiHero({
          filePath,
          title,
          slug,
          body: postBody,
          description,
          newsletterSubject,
          newsletterPreviewText,
          newsletterCopy,
          onProgress: (percentage) => {
            sendEvent("progress", { percentage });
          },
        });

        sendEvent("complete", { slug: result.slug });
      });

      program
        .pipe(
          Effect.catchTag("AiHeroNotAuthenticatedError", () =>
            Effect.sync(() => {
              sendEvent("error", {
                message: "Not authenticated with AI Hero",
              });
            })
          ),
          Effect.catchTag("AiHeroUploadError", (e) =>
            Effect.sync(() => {
              sendEvent("error", { message: e.message });
            })
          ),
          Effect.catchAll((e) =>
            Effect.sync(() => {
              sendEvent("error", {
                message:
                  "message" in e && typeof e.message === "string"
                    ? e.message
                    : "Skills Changelog post failed unexpectedly",
              });
            })
          ),
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
