import { makeAction } from "@/services/route-action.server";
import { generateSuggestNextClipPromptParts } from "@/prompts/generate-suggest-next-clip";
import { CACHE_BREAKPOINT_5M } from "@/services/prompt-cache";
import { streamText } from "ai";
import { Effect, Schema } from "effect";
import { anthropic } from "@ai-sdk/anthropic";

/** The Suggestions tab's model: fast, because it races the next Take. */
export const SUGGEST_NEXT_CLIP_MODEL = "claude-haiku-5-5";

/**
 * Streams the Suggestions tab's next line as plain text. The editor sends the
 * sources the author ticked and the Clip transcripts it already holds,
 * so this route reads nothing and starts the model call at once. The plan
 * (role and sources) is cached for five minutes: it is the same for every
 * Clip of a take, so only the Clips are read fresh, which shortens the wait
 * for the first word. Aborting the request (a newer suggestion, or
 * the tab closing) aborts the model call.
 */
const requestSchema = Schema.Struct({
  notes: Schema.optional(Schema.String),
  script: Schema.optional(Schema.String),
  animatic: Schema.optional(Schema.String),
  beats: Schema.optional(Schema.String),
  clips: Schema.Array(Schema.String),
});

export const action = makeAction({
  input: "json",
  effect: ({ payload, request }) =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknown(requestSchema)(payload);

      const { plan, now } = generateSuggestNextClipPromptParts({
        ...input,
        clips: [...input.clips],
      });
      const result = streamText({
        model: anthropic(SUGGEST_NEXT_CLIP_MODEL),
        system: [
          {
            role: "system",
            content: plan,
            providerOptions: CACHE_BREAKPOINT_5M,
          },
          { role: "system", content: now },
        ],
        messages: [{ role: "user", content: "What do I say next?" }],
        abortSignal: request.signal,
      });

      return result.toTextStreamResponse();
    }),
});
