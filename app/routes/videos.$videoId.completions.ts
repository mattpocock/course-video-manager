import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  streamText,
  type StreamTextTransform,
  type TextStreamPart,
  type ToolSet,
  type UIMessage,
} from "ai";
import { Data, Effect, Schema } from "effect";
import type { Route } from "./+types/videos.$videoId.completions";
import { DBService } from "@/services/db-service";
import { FileSystem } from "@effect/platform";
import path from "node:path";
import { layerLive } from "@/services/layer";
import { generateArticlePrompt } from "@/prompts/generate-article";
import { getVideoTranscriptPath } from "@/lib/get-video";
import { readFile } from "node:fs/promises";
import dedent from "dedent";
import { ZodType } from "zod";

const chatSchema = Schema.Struct({
  messages: Schema.Any,
});

const NOT_A_FILE = Symbol("NOT_A_FILE");

class CouldNotFindTranscript extends Data.TaggedError(
  "CouldNotFindTranscript"
)<{
  readonly originalFootagePath: string;
}> {}

const ALLOWED_FILE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "md",
  "mdx",
  "txt",
  "csv",
];

const DISALLOWED_FILE_DIRECTORIES = [
  "node_modules",
  ".vite",
  "readme.md",
  "solution",
];

export const action = async (args: Route.ActionArgs) => {
  const body = await args.request.json();
  const videoId = args.params.videoId;

  return Effect.gen(function* () {
    const db = yield* DBService;
    const fs = yield* FileSystem.FileSystem;

    const { messages }: { messages: UIMessage[] } = yield* Schema.decodeUnknown(
      chatSchema
    )(body);

    const video = yield* db.getVideoById(videoId);

    const repo = video.lesson.section.repo;
    const section = video.lesson.section;
    const lesson = video.lesson;

    const lessonPath = path.join(repo.filePath, section.path, lesson.path);

    const allFilesInDirectory = yield* fs
      .readDirectory(lessonPath, {
        recursive: true,
      })
      .pipe(
        Effect.map((files) => files.map((file) => path.join(lessonPath, file)))
      );

    const filteredFiles = allFilesInDirectory.filter((filePath) => {
      return (
        !DISALLOWED_FILE_DIRECTORIES.some((disallowedPath) =>
          filePath.includes(disallowedPath)
        ) && ALLOWED_FILE_EXTENSIONS.includes(path.extname(filePath).slice(1))
      );
    });

    const files = yield* Effect.forEach(filteredFiles, (filePath) => {
      return Effect.gen(function* () {
        const stat = yield* fs.stat(filePath);

        if (stat.type !== "File") {
          return NOT_A_FILE;
        }

        const fileContent = yield* fs.readFileString(filePath);
        return {
          filePath,
          fileContent,
        };
      });
    }).pipe(Effect.map((res) => res.filter((r) => r !== NOT_A_FILE)));

    const transcript = yield* fs
      .readFileString(getVideoTranscriptPath(video.originalFootagePath))
      .pipe(
        Effect.mapError(
          (e) =>
            new CouldNotFindTranscript({
              originalFootagePath: video.originalFootagePath,
            })
        )
      );

    const result = streamText({
      model: anthropic("claude-3-7-sonnet-20250219"),
      messages: convertToModelMessages(messages),
      system: generateArticlePrompt({
        code: files.map((file) => ({
          path: file.filePath,
          content: file.fileContent,
        })),
        transcript,
      }),
      experimental_transform: () => {
        let state: CodeSnippetTransformState = {
          type: "not-capturing-code-snippet",
        } as CodeSnippetTransformState;

        return new TransformStream<
          TextStreamPart<ToolSet>,
          TextStreamPart<ToolSet>
        >({
          async transform(chunk, controller) {
            if (chunk.type !== "text-delta") {
              controller.enqueue(chunk);
              return;
            }

            console.log(chunk.text);

            if (state.type === "not-capturing-code-snippet") {
              if (chunk.text.includes("<")) {
                // Enqueue everything up to the code snippet
                const codeSnippetIndex = chunk.text.indexOf("<");
                const textToEnqueue = chunk.text.slice(0, codeSnippetIndex);

                controller.enqueue({
                  ...chunk,
                  text: textToEnqueue,
                });

                // Change the state to capturing code snippet
                state = {
                  type: "maybe-code-snippet",
                  candidate: chunk.text.slice(codeSnippetIndex),
                };

                return;
              } else {
                controller.enqueue(chunk);
                return;
              }
            }

            if (state.type === "maybe-code-snippet") {
              state.candidate += chunk.text;

              if (state.candidate.includes("<code-snippet")) {
                state = {
                  type: "capturing-code-snippet",
                  codeSnippet: state.candidate,
                };

                return;
              } else if (state.candidate.length > "<code-snippet".length) {
                controller.enqueue({
                  ...chunk,
                  text: state.candidate,
                });

                state = {
                  type: "not-capturing-code-snippet",
                };

                return;
              }

              return;
            }
            if (state.type === "capturing-code-snippet") {
              const END_OF_CODE_SNIPPET = "</code-snippet>";
              if (chunk.text.includes(END_OF_CODE_SNIPPET)) {
                // Put everything up to the end of the code snippet
                // into the state
                const codeSnippetEndIndex =
                  chunk.text.indexOf(END_OF_CODE_SNIPPET);

                state.codeSnippet += chunk.text.slice(
                  0,
                  codeSnippetEndIndex + END_OF_CODE_SNIPPET.length
                );

                const code = await parseCodeSnippet(state.codeSnippet);

                // Enqueue everything not in the code snippet
                const textToEnqueue = chunk.text.slice(
                  codeSnippetEndIndex + END_OF_CODE_SNIPPET.length
                );

                controller.enqueue({
                  ...chunk,
                  text: code + textToEnqueue,
                });

                state = {
                  type: "not-capturing-code-snippet",
                };

                return;
              } else {
                state.codeSnippet += chunk.text;
                return;
              }
            }

            state satisfies never;
          },
        });
      },
    });

    return result.toUIMessageStreamResponse();
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};

type CodeSnippetTransformState =
  | {
      type: "capturing-code-snippet";
      codeSnippet: string;
    }
  | {
      type: "maybe-code-snippet";
      candidate: string;
    }
  | {
      type: "not-capturing-code-snippet";
    };

const parseCodeSnippet = async (codeSnippet: string): Promise<string> => {
  const filePath = codeSnippet.match(/path="([^"]+)"/)?.[1];
  const startText = codeSnippet.match(/startText="([^"]+)"/)?.[1];
  const endText = codeSnippet.match(/endText="([^"]+)"/)?.[1];

  if (
    typeof filePath !== "string" ||
    typeof startText !== "string" ||
    typeof endText !== "string"
  ) {
    return [
      "\n",
      "```txt",
      "Code snippet could not be generated",
      "```",
      "\n",
    ].join("\n");
  }

  const result = await readFile(filePath, "utf-8");

  const markdownFileType = path.extname(filePath).slice(1);

  const startIndex = result.indexOf(startText);
  const endIndex = result.indexOf(endText, startIndex + startText.length);

  const code = result.slice(startIndex, endIndex + endText.length).trim();

  return ["\n", `\`\`\`${markdownFileType}`, code, `\`\`\`\n`].join("\n");
};
