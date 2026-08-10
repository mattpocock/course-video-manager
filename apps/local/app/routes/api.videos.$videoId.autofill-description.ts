import { LinkAuthOperationsService } from "@/services/db-link-auth-operations.server";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { TextGenerationService } from "@/services/text-generation-service";
import { Effect } from "effect";
import { makeAction } from "@/services/route-action.server";

/**
 * The per-Video **Autofill description** action: an SEO description written
 * from the lesson **Body** alone (never the transcript). Returns `{ error }`
 * when the body is empty so the modal can surface it without hitting the
 * model — the same precondition the batch Autofill applies when it decides a
 * Video is not an **Autofill Candidate** at all.
 */
export const action = makeAction({
  input: "json",
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
      const textGeneration = yield* TextGenerationService;
      const links = yield* linkAuthOps.getLinks();

      const text = yield* textGeneration.autofillDescription({ body, links });

      return { text } as const;
    }),
});
