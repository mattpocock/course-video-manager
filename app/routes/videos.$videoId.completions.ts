import { getVideoTranscriptPath } from "@/lib/get-video";
import { generateArticlePrompt } from "@/prompts/generate-article";
import { generateStepsToCompleteForProjectPrompt } from "@/prompts/generate-steps-to-complete-for-project";
import { generateStepsToCompleteForSkillBuildingProblemPrompt } from "@/prompts/generate-steps-to-complete-for-skill-building-problem";
import { DBService } from "@/services/db-service";
import { layerLive } from "@/services/layer";
import { anthropic } from "@ai-sdk/anthropic";
import { FileSystem } from "@effect/platform";
import {
  convertToModelMessages,
  streamText,
  type TextStreamPart,
  type ToolSet,
  type UIMessage,
} from "ai";
import { Array, Data, Effect, Schema } from "effect";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Route } from "./+types/videos.$videoId.completions";

const chatSchema = Schema.Struct({
  messages: Schema.Any,
  enabledFiles: Schema.Array(Schema.String),
  mode: Schema.String,
});

const NOT_A_FILE = Symbol("NOT_A_FILE");

class CouldNotFindTranscript extends Data.TaggedError(
  "CouldNotFindTranscript"
)<{
  readonly originalFootagePath: string;
}> {}

export const DEFAULT_CHECKED_EXTENSIONS = [
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

export const ALWAYS_EXCLUDED_DIRECTORIES = ["node_modules", ".vite"];

export const DEFAULT_UNCHECKED_PATHS = ["readme.md", "speaker-notes.md"];

const transcriptSchema = Schema.Struct({
  clips: Schema.Array(
    Schema.Struct({
      start: Schema.Number,
      end: Schema.Number,
      segments: Schema.Array(
        Schema.Struct({
          start: Schema.Number,
          end: Schema.Number,
          text: Schema.String,
        })
      ),
      words: Schema.Array(
        Schema.Struct({
          start: Schema.Number,
          end: Schema.Number,
          text: Schema.String,
        })
      ),
    })
  ),
});

export const action = async (args: Route.ActionArgs) => {
  const body = await args.request.json();
  const videoId = args.params.videoId;

  return Effect.gen(function* () {
    const db = yield* DBService;
    const fs = yield* FileSystem.FileSystem;

    const parsed = yield* Schema.decodeUnknown(chatSchema)(body);
    const messages: UIMessage[] = parsed.messages;
    const enabledFiles: string[] = [...parsed.enabledFiles];
    const mode: string = parsed.mode;

    const video = yield* db.getVideoWithClipsById(videoId);

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
      const relativePath = path.relative(lessonPath, filePath);
      return (
        !ALWAYS_EXCLUDED_DIRECTORIES.some((excludedDir) =>
          filePath.includes(excludedDir)
        ) && enabledFiles.includes(relativePath)
      );
    });

    const allFiles = yield* Effect.forEach(filteredFiles, (filePath) => {
      return Effect.gen(function* () {
        const stat = yield* fs.stat(filePath);

        if (stat.type !== "File") {
          return NOT_A_FILE;
        }

        const relativePath = path.relative(lessonPath, filePath);
        const isDiagram =
          filePath.includes("diagram") && filePath.endsWith(".png");

        if (isDiagram) {
          const fileContent = yield* fs.readFile(filePath);
          return {
            type: "diagram" as const,
            path: relativePath,
            content: fileContent,
          };
        } else {
          const fileContent = yield* fs.readFileString(filePath);
          return {
            type: "text" as const,
            filePath,
            fileContent,
          };
        }
      });
    }).pipe(Effect.map(Array.filter((r) => r !== NOT_A_FILE)));

    const textFiles = allFiles
      .filter((f) => f.type === "text")
      .map((f) => ({
        filePath: f.filePath,
        fileContent: f.fileContent,
      }));

    const diagramFiles = allFiles
      .filter((f) => f.type === "diagram")
      .map((f) => ({
        path: f.path,
        content: f.content,
      }));

    let transcript = video.clips
      .map((clip) => clip.text)
      .join(" ")
      .trim();

    if (transcript.length === 0) {
      const transcriptFile = yield* fs.readFileString(
        getVideoTranscriptPath(video.originalFootagePath)
      );
      const transcriptFileData = yield* Schema.decodeUnknown(transcriptSchema)(
        transcriptFile
      );
      transcript = transcriptFileData.clips
        .map((clip) => clip.segments.map((segment) => segment.text).join(" "))
        .join(" ");
    }

    if (transcript.length === 0) {
      throw new CouldNotFindTranscript({
        originalFootagePath: video.originalFootagePath,
      });
    }

    const modelMessages = convertToModelMessages(messages);

    if (diagramFiles.length > 0) {
      modelMessages.unshift({
        role: "user",
        content: diagramFiles.flatMap((file) => {
          return [
            {
              type: "text",
              text: `The following diagram is at "${file.path}":`,
            },
            {
              type: "image",
              image: file.content,
            },
          ];
        }),
      });
    }

    const codeContext = textFiles.map((file) => ({
      path: file.filePath,
      content: file.fileContent,
    }));

    const systemPrompt = (() => {
      switch (mode) {
        case "project":
          return generateStepsToCompleteForProjectPrompt({
            code: codeContext,
            transcript,
          });
        case "skill-building":
          return generateStepsToCompleteForSkillBuildingProblemPrompt({
            code: codeContext,
            transcript,
          });
        case "article":
        default:
          return generateArticlePrompt({
            code: codeContext,
            transcript,
          });
      }
    })();

    const result = streamText({
      model: anthropic("claude-sonnet-4-5"),
      messages: modelMessages,
      system: systemPrompt,
      // experimental_transform: xmlTagTransform({
      //   name: "code-snippet",
      //   attributes: ["path", "startText", "endText"],
      //   transform: ({ attributes }) =>
      //     parseCodeSnippet({
      //       cwd: lessonPath,
      //       path: attributes.path,
      //       startText: attributes.startText,
      //       endText: attributes.endText,
      //     }),
      // }),
    });

    return result.toUIMessageStreamResponse();
  }).pipe(Effect.provide(layerLive), Effect.runPromise);
};

const xmlTagTransform =
  <const TAttribute extends string>(opts: {
    name: string;
    attributes: TAttribute[];
    transform: (opts: {
      attributes: Record<TAttribute, string>;
    }) => Promise<string> | string;
  }) =>
  () => {
    const startTag = `<${opts.name}`;
    const endTag = `</${opts.name}>`;
    let state: XMLTagTransformState = {
      type: "not-capturing-xml-tag",
    } as XMLTagTransformState;

    return new TransformStream<
      TextStreamPart<ToolSet>,
      TextStreamPart<ToolSet>
    >({
      async transform(chunk, controller) {
        if (chunk.type !== "text-delta") {
          controller.enqueue(chunk);
          return;
        }

        if (state.type === "not-capturing-xml-tag") {
          if (chunk.text.includes(`<`)) {
            // Enqueue everything up to the code snippet
            const xmlTagIndex = chunk.text.indexOf(`<`);
            const textToEnqueue = chunk.text.slice(0, xmlTagIndex);

            controller.enqueue({
              ...chunk,
              text: textToEnqueue,
            });

            // Change the state to capturing code snippet
            state = {
              type: "maybe-xml-tag",
              candidate: chunk.text.slice(xmlTagIndex),
            };

            return;
          } else {
            controller.enqueue(chunk);
            return;
          }
        }

        if (state.type === "maybe-xml-tag") {
          state.candidate += chunk.text;

          if (state.candidate.includes(startTag)) {
            state = {
              type: "capturing-xml-tag",
              xmlTag: state.candidate,
            };

            return;
          } else if (state.candidate.length > startTag.length) {
            controller.enqueue({
              ...chunk,
              text: state.candidate,
            });

            state = {
              type: "not-capturing-xml-tag",
            };

            return;
          }

          return;
        }
        if (state.type === "capturing-xml-tag") {
          state.xmlTag += chunk.text;
          if (state.xmlTag.includes(endTag)) {
            // Put everything up to the end of the code snippet
            // into the state
            const xmlTagEndIndex = state.xmlTag.indexOf(endTag);

            const xmlTag = state.xmlTag.slice(
              0,
              xmlTagEndIndex + endTag.length
            );

            const textAfterXmlTag = state.xmlTag.slice(
              xmlTagEndIndex + endTag.length
            );

            const attributesObject = opts.attributes.reduce(
              (acc, attribute) => {
                const value = xmlTag.match(
                  new RegExp(`${attribute}="([^"]+)"`)
                )?.[1];
                if (value) {
                  acc[attribute] = value;
                }
                return acc;
              },
              {} as Record<TAttribute, string>
            );

            for (const attribute of opts.attributes) {
              if (!attributesObject[attribute]) {
                // TODO - throw a custom error
                throw new Error(`Missing attribute: ${attribute} in ${xmlTag}`);
              }
            }

            const code = await opts.transform({
              attributes: attributesObject,
            });

            controller.enqueue({
              ...chunk,
              text: code + textAfterXmlTag,
            });

            state = {
              type: "not-capturing-xml-tag",
            };

            return;
          } else {
            return;
          }
        }

        state satisfies never;
      },
    });
  };

type XMLTagTransformState =
  | {
      type: "capturing-xml-tag";
      xmlTag: string;
    }
  | {
      type: "maybe-xml-tag";
      candidate: string;
    }
  | {
      type: "not-capturing-xml-tag";
    };

const parseCodeSnippet = async (opts: {
  cwd: string;
  path: string;
  startText: string;
  endText: string;
}): Promise<string> => {
  const result = await readFile(path.resolve(opts.cwd, opts.path), "utf-8");

  const markdownFileType = path.extname(opts.path).slice(1);

  const startIndex = result.indexOf(opts.startText);
  const endIndex = result.indexOf(
    opts.endText,
    startIndex + opts.startText.length
  );

  const code = result.slice(startIndex, endIndex + opts.endText.length).trim();

  return ["\n", `\`\`\`${markdownFileType}`, code, `\`\`\`\n`].join("\n");
};
