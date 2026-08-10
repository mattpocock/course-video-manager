import { sortByOrder } from "@/lib/sort-by-order";
import { runtimeLive } from "@/services/layer.server";
import { acquireTextWritingContext } from "@/services/text-writing-agent";
import {
  generateSuggestNextClipPrompt,
  type FewShotExample,
} from "@/prompts/generate-suggest-next-clip";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { ToolLoopAgent as Agent } from "ai";
import { Console, Effect, Schema } from "effect";
import type { Route } from "./+types/videos.$videoId.suggest-next-clip";
import { anthropic } from "@ai-sdk/anthropic";
import { data } from "react-router";

const requestSchema = Schema.Struct({
  enabledFiles: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => [],
  }),
  // When set, truncate the transcript to only include clips up to and including this clip ID
  truncateAfterClipId: Schema.optionalWith(
    Schema.Union(Schema.String, Schema.Null),
    { default: () => null }
  ),
});

/**
 * Build a transcript for suggestions, optionally truncated after a specific clip.
 * The transcript is formatted clip-by-clip for clarity.
 */
const buildSuggestionTranscript = (
  clips: { id: string; text: string | null; order: string }[],
  truncateAfterClipId: string | null
): string => {
  // Sort clips by order
  const sortedClips = sortByOrder(clips);

  // Find truncation point if specified
  let clipsToInclude = sortedClips;
  if (truncateAfterClipId) {
    const truncateIndex = sortedClips.findIndex(
      (clip) => clip.id === truncateAfterClipId
    );
    if (truncateIndex !== -1) {
      clipsToInclude = sortedClips.slice(0, truncateIndex + 1);
    }
  }

  // Build clip-by-clip transcript
  const transcriptLines = clipsToInclude
    .filter((clip) => clip.text && clip.text.trim().length > 0)
    .map((clip, index) => `Clip ${index + 1}: ${clip.text}`)
    .join("\n");

  return transcriptLines;
};

export const action = async (args: Route.ActionArgs) => {
  const body = await args.request.json();
  const videoId = args.params.videoId;

  return Effect.gen(function* () {
    const videoOps = yield* VideoOperationsService;
    const parsed = yield* Schema.decodeUnknown(requestSchema)(body);
    const enabledFiles: string[] = [...parsed.enabledFiles];
    const truncateAfterClipId = parsed.truncateAfterClipId;

    const videoContext = yield* acquireTextWritingContext({
      videoId,
      enabledFiles,
      includeTranscript: false, // We'll build our own transcript
      enabledSections: [],
    });

    // Get the video with clips for building the transcript
    const video = yield* videoOps.getVideoWithClipsById(videoId);

    // Build transcript, truncated if specified
    const transcript = buildSuggestionTranscript(
      video.clips,
      truncateAfterClipId
    );

    // Get videos for few-shot examples (excluding current video)
    const exampleVideos = yield* videoOps.getVideosForFewShotExamples(videoId);

    // Build few-shot examples from the example videos
    // For each video, take the clip transcripts to show the progression
    const fewShotExamples: FewShotExample[] = exampleVideos
      .map((video) => {
        // Get all clip transcripts that have text
        const clipTranscripts = video.clips
          .filter((clip) => clip.text && clip.text.trim().length > 0)
          .map((clip) => clip.text);

        return { clipTranscripts };
      })
      .filter((example) => example.clipTranscripts.length >= 2);

    console.log(fewShotExamples);

    const systemPrompt = generateSuggestNextClipPrompt({
      code: videoContext.textFiles,
      transcript,
      fewShotExamples,
    });

    const agent = new Agent({
      model: anthropic("claude-haiku-4-5"),
      instructions: systemPrompt,
    });

    const result = yield* Effect.tryPromise(() =>
      agent.stream({
        messages: [
          {
            role: "user",
            content: "Go.",
          },
        ],
      })
    );

    return result.toUIMessageStreamResponse();
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () => {
      return Effect.die(data("Invalid request", { status: 400 }));
    }),
    Effect.catchAll(() => {
      return Effect.die(data("Internal server error", { status: 500 }));
    }),
    runtimeLive.runPromise
  );
};
