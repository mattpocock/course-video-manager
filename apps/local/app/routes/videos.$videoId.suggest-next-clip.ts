import { makeAction } from "@/services/route-action.server";
import {
  generateSuggestNextClipPromptParts,
  suggestionsLineStream,
  suggestionsSchema,
  type SuggestNextClipRepoFile,
} from "@/prompts/generate-suggest-next-clip";
import { CACHE_BREAKPOINT_5M } from "@/services/prompt-cache";
import { VideoOperationsService } from "@/services/db-video-operations.server";
import { DiagramOperationsService } from "@/services/db-diagram-operations.server";
import { extractSceneLines } from "@cvm/core/lib/extract-scene-text/index";
import { readVideoFilesForPrompt } from "@/services/text-writing-agent";
import { isImageFilePath } from "@/lib/image-file-path";
import { createTextStreamResponse, Output, streamText } from "ai";
import { Effect, Schema } from "effect";
import { writerLanguageModel } from "@/services/fake-writer-model";

/** The Suggestions tab's model: fast, because it races the next Take. */
export const SUGGEST_NEXT_CLIP_MODEL = "claude-haiku-5-5";

/**
 * Streams the Suggestions tab's one Suggestion as newline-delimited JSON
 * (`suggestionsLineStream`): only the `text` field of the model's structured
 * answer (`suggestionsSchema`), resent as it
 * grows. With `CVM_FAKE_WRITER_MODEL=1` the fake writer answers. The editor sends the
 * sources the author ticked and the Clip transcripts it already holds, so
 * this route reads nothing and starts the model call at once, unless the
 * author picked repo files in the Context modal: those it reads from the
 * Video's directory, through the Article Writer's loader, text files only,
 * and the DiagramSnapshot pinned to the Clip before the Insertion Point,
 * whose text the on-screen Diagram is diffed against. The plan
 * (role and sources) is cached for five minutes: it is the same for every
 * Clip of a take, so only the Clips are read fresh, which shortens the wait
 * for the first word. Aborting the request (a newer suggestion, or
 * the tab closing) aborts the model call.
 */
const requestSchema = Schema.Struct({
  steer: Schema.optional(Schema.String),
  script: Schema.optional(Schema.String),
  animatic: Schema.optional(Schema.String),
  beats: Schema.optional(Schema.String),
  diagram: Schema.optional(Schema.String),
  diagramSnapshotId: Schema.optional(Schema.String),
  /** Capped by the prompt, keeping the end, however long it arrives. */
  previousVideo: Schema.optional(Schema.String),
  clips: Schema.Array(Schema.String),
  files: Schema.optional(Schema.Array(Schema.String)),
});

export const action = makeAction({
  input: "json",
  effect: ({ params, payload, request }) =>
    Effect.gen(function* () {
      const input = yield* Schema.decodeUnknown(requestSchema)(payload);

      const picked = (input.files ?? []).filter(
        (path) => !isImageFilePath(path)
      );
      let files: SuggestNextClipRepoFile[] = [];
      if (picked.length > 0) {
        const videoOps = yield* VideoOperationsService;
        const video = yield* videoOps.getVideoWithLessonById(params.videoId!);
        const read = yield* readVideoFilesForPrompt({
          lineageId: video.lineageId,
          enabledFiles: picked,
        });
        files = read.textFiles;
      }

      // A snapshot that is gone leaves the Diagram as plain text.
      const lastClipDiagram = input.diagramSnapshotId
        ? yield* Effect.gen(function* () {
            const diagramOps = yield* DiagramOperationsService;
            const snapshot = yield* diagramOps.getDiagramSnapshot(
              input.diagramSnapshotId!
            );
            return extractSceneLines(snapshot.scene).join("\n");
          }).pipe(
            Effect.catchTag("NotFoundError", () => Effect.succeed(undefined))
          )
        : undefined;

      const { plan, now } = generateSuggestNextClipPromptParts({
        ...input,
        lastClipDiagram,
        clips: [...input.clips],
        files,
      });
      const result = streamText({
        model: writerLanguageModel(SUGGEST_NEXT_CLIP_MODEL),
        output: Output.object({ schema: suggestionsSchema }),
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

      return createTextStreamResponse({
        textStream: suggestionsLineStream(result.partialOutputStream),
      });
    }),
});
