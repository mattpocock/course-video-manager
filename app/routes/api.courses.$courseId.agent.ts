import { runtimeLive } from "@/services/layer.server";
import { buildVfsForCourse } from "@/services/vfs/vfs-loader.server";
import { normalizePath, vfsLs } from "@/services/vfs";
import {
  ToolLoopAgent as Agent,
  convertToModelMessages,
  type UIMessage,
} from "ai";
import { tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { Console, Effect, Schema } from "effect";
import { data } from "react-router";
import { z } from "zod";

const requestSchema = Schema.Struct({
  messages: Schema.Any,
  versionId: Schema.optional(Schema.String),
});

const SYSTEM_PROMPT = (
  anchor: string
) => `You are a read-only course explorer. You navigate a virtual filesystem (VFS) that mirrors the structure of video courses. The current course is mounted at "${anchor}".

## Path conventions
- Bare or relative paths resolve against the current course: "${anchor}"
- \`/\` is the catalogue root (lists all courses)
- \`.\` is the current course
- \`..\` resolves to /courses (sibling courses)
- Directories have a trailing \`/\` in listings
- \`[ghost]\` marks sections or lessons that exist in planning but haven't been recorded yet

## VFS structure
\`\`\`
/courses/<course>/
  course.json
  sections/
    <section>/
      section.json
      lessons/
        <lesson>/
          lesson.json
          videos/
            <video>/
              video.json
              segments.json
              timeline.json
\`\`\`

## Guidelines
- Use \`ls\` to explore the directory tree
- Answer questions about the course by navigating the VFS
- When you encounter an error (e.g. "No such file or directory"), adjust your path and try again
- Be concise in your answers
- Cite specific paths when referencing content`;

export const action = async (args: {
  request: Request;
  params: Record<string, string | undefined>;
}) => {
  const body = await args.request.json();
  const courseId = args.params.courseId!;

  return Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknown(requestSchema)(body);
    const messages: UIMessage[] = parsed.messages;

    const { root, anchor } = yield* buildVfsForCourse(
      courseId,
      parsed.versionId
    );

    const lsTool = tool({
      description:
        "List the contents of a directory. Directories have a trailing `/`. Ghost (planned but unrecorded) items are tagged `[ghost]`.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "The directory path to list. Bare/relative paths resolve against the current course."
          ),
      }),
      execute: async ({ path }) => {
        const absolute = normalizePath(path, anchor);
        return vfsLs(root, absolute);
      },
    });

    const modelMessages = yield* Effect.tryPromise(() =>
      convertToModelMessages(messages)
    );

    const agent = new Agent({
      model: anthropic("claude-haiku-4-5"),
      instructions: SYSTEM_PROMPT(anchor),
      tools: { ls: lsTool },
    });

    const result = yield* Effect.tryPromise(() =>
      agent.stream({ messages: modelMessages })
    );

    return result.toUIMessageStreamResponse({
      messageMetadata({ part }) {
        if (part.type === "finish-step") {
          return {
            usage: {
              inputTokens: part.usage.inputTokens,
              outputTokens: part.usage.outputTokens,
            },
          };
        }
        return undefined;
      },
    });
  }).pipe(
    Effect.tapErrorCause((e) => Console.dir(e, { depth: null })),
    Effect.catchTag("ParseError", () =>
      Effect.die(data("Invalid request", { status: 400 }))
    ),
    Effect.catchAll(() =>
      Effect.die(data("Internal server error", { status: 500 }))
    ),
    runtimeLive.runPromise
  );
};
