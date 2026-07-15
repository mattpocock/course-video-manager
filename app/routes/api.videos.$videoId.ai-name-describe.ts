import { VideoOperationsService } from "@/services/db-video-operations.server";
import {
  generateShortTitlePrompt,
  generateShortDescriptionPrompt,
} from "@/prompts/generate-short-title-description";
import { Effect } from "effect";
import { makeAction } from "@/services/route-action.server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

export const action = makeAction({
  input: "json",
  effect: ({ params }) =>
    Effect.gen(function* () {
      const videoId = params.videoId!;
      const videoOps = yield* VideoOperationsService;

      const video = yield* videoOps.getVideoWithClipsById(videoId);

      if (video.clips.length === 0) {
        return Response.json({ title: null, description: null });
      }

      const transcript = video.clips
        .map((clip) => clip.text)
        .filter(Boolean)
        .join(" ");

      if (!transcript.trim()) {
        return Response.json({ title: null, description: null });
      }

      const [titleResult, descriptionResult] = yield* Effect.all([
        Effect.tryPromise(() =>
          generateText({
            model: anthropic("claude-haiku-4-5-20251001"),
            system: generateShortTitlePrompt({ transcript }),
            messages: [{ role: "user", content: "Go" }],
          })
        ),
        Effect.tryPromise(() =>
          generateText({
            model: anthropic("claude-haiku-4-5-20251001"),
            system: generateShortDescriptionPrompt({ transcript }),
            messages: [{ role: "user", content: "Go" }],
          })
        ),
      ]);

      const title = titleResult.text.trim();
      const description = descriptionResult.text.trim();

      yield* videoOps.updateVideoTitle({ videoId, title });
      yield* videoOps.updateVideoDescription({ videoId, description });

      return Response.json({ title, description });
    }),
});
