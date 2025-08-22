import { anthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { Data, Effect, Schema } from "effect";
import type { Route } from "./+types/videos.$videoId.completions";
import { DBService } from "@/services/db-service";
import { FileSystem } from "@effect/platform";
import path from "node:path";
import { layerLive } from "@/services/layer";
import { generateArticlePrompt } from "@/prompts/generate-article";
import { getVideoTranscriptPath } from "@/lib/get-video";

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
    });

    return result.toUIMessageStreamResponse();
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};
