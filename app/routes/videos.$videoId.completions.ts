import { layerLive } from "@/services/layer";
import {
  acquireTextWritingContext,
  createModelMessagesForTextWritingAgent,
  createTextWritingAgent,
} from "@/services/text-writing-agent";
import { type UIMessage } from "ai";
import { Effect, Schema } from "effect";
import type { Route } from "./+types/videos.$videoId.completions";
import { anthropic } from "@ai-sdk/anthropic";

const chatSchema = Schema.Struct({
  messages: Schema.Any,
  enabledFiles: Schema.Array(Schema.String),
  mode: Schema.Union(
    Schema.Literal("article"),
    Schema.Literal("project"),
    Schema.Literal("skill-building"),
    Schema.Literal("style-guide-skill-building")
  ),
  model: Schema.String,
});

export const action = async (args: Route.ActionArgs) => {
  const body = await args.request.json();
  const videoId = args.params.videoId;

  return Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknown(chatSchema)(body);
    const messages: UIMessage[] = parsed.messages;
    const enabledFiles: string[] = [...parsed.enabledFiles];
    const mode = parsed.mode;
    const model: string = parsed.model;

    const videoContext = yield* acquireTextWritingContext({
      videoId,
      enabledFiles,
    });

    const modelMessages = createModelMessagesForTextWritingAgent({
      messages,
      imageFiles: videoContext.imageFiles,
    });

    const agent = createTextWritingAgent({
      model: anthropic(model),
      mode: mode,
      transcript: videoContext.transcript,
      code: videoContext.textFiles,
      imageFiles: videoContext.imageFiles,
    });

    const result = agent.stream({
      messages: modelMessages,
    });

    return result.toUIMessageStreamResponse();
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};
