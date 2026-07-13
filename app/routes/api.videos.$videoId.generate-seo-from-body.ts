import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { generateSeoDescriptionFromBodyPrompt } from "@/prompts/generate-seo-description-from-body";
import { Effect } from "effect";
import { makeAction } from "@/services/route-action.server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

/**
 * Generate an SEO description from the lesson body only (ignoring the
 * transcript). Returns `{ error }` when the body is empty so the modal can
 * surface it without hitting the model.
 */
export const action = makeAction({
  input: "json",
  dump: false,
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;
      const video = yield* videoOps.getVideoWithLessonById(videoId);
      const body = (video.body ?? "").trim();

      if (!body) {
        return {
          error: "The lesson body is empty. Write a lesson body first.",
        } as const;
      }

      const linkAuthOps = yield* LinkAuthOperationsService;
      const links = yield* linkAuthOps.getLinks();

      const systemPrompt = generateSeoDescriptionFromBodyPrompt({ body, links });

      const result = yield* Effect.tryPromise(() =>
        generateText({
          model: anthropic("claude-haiku-4-5-20251001"),
          system: systemPrompt,
          messages: [{ role: "user", content: "Go" }],
        })
      );

      return { text: result.text } as const;
    }),
});
