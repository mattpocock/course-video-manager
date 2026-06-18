import { runtimeLive } from "@/services/layer.server";
import { buildVfsForCourse } from "@/services/vfs/vfs-loader.server";
import { normalizePath, vfsLs, vfsTree, vfsCat, vfsGrep } from "@/services/vfs";
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
- Use \`ls\` to list a directory, \`tree\` for a recursive overview, \`cat\` to read a file, and \`grep\` to search
- \`cat\` supports a \`filter\` argument for projecting large files: \`.[i]\` (single item), \`.[i:j]\` (slice), \`names\` (chapter names), \`text\` (clip texts), \`count\` (item/chapter/clip counts), \`.field\` (single field)
- \`grep\` searches with case-insensitive regex. Omit \`path\` to search the current course; use \`/\` for all courses. Content mode reports locators that round-trip into \`cat path .[i]\`
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

    const treeTool = tool({
      description:
        "Print a recursive indented tree of a directory subtree. Full depth by default. Ghost (planned but unrecorded) items are tagged `[ghost]`.",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe(
            "The directory path to tree. Defaults to the current course."
          ),
        depth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum depth to recurse. Omit for full depth."),
      }),
      execute: async ({ path, depth }) => {
        const absolute = normalizePath(path ?? ".", anchor);
        return vfsTree(root, absolute, depth);
      },
    });

    const catTool = tool({
      description:
        "Read a leaf file's JSON content. Supports an optional filter for projecting large files: `.[i]` (item at index), `.[i:j]` (slice), `names` (chapter names), `text` (clip texts), `count` (item counts), `.field` (single field).",
      inputSchema: z.object({
        path: z.string().describe("The file path to read."),
        filter: z
          .string()
          .optional()
          .describe(
            "Projection filter: .[i], .[i:j], names, text, count, or .field"
          ),
      }),
      execute: async ({ path, filter }) => {
        const absolute = normalizePath(path, anchor);
        return vfsCat(root, absolute, filter);
      },
    });

    const grepTool = tool({
      description:
        "Search file content and names with regex (Postgres ~* case-insensitive). Returns matches with locators that round-trip into `cat path .[i]`. Content mode: one line per hit `path[locator]: <text>`. Files mode: deduped paths with ≥1 match.",
      inputSchema: z.object({
        pattern: z
          .string()
          .describe("Case-insensitive regex pattern to search for."),
        path: z
          .string()
          .optional()
          .describe(
            "Scope search to this subtree (prefix match). Omit to search the current course; use `/` for catalogue-wide."
          ),
        mode: z
          .enum(["content", "files"])
          .optional()
          .describe(
            "Output mode: `content` (default) shows each hit with locator; `files` shows deduped paths."
          ),
      }),
      execute: async ({ pattern, path, mode }) => {
        const absolute = normalizePath(path ?? ".", anchor);
        return vfsGrep(root, pattern, absolute, mode);
      },
    });

    const modelMessages = yield* Effect.tryPromise(() =>
      convertToModelMessages(messages)
    );

    const agent = new Agent({
      model: anthropic("claude-haiku-4-5"),
      instructions: SYSTEM_PROMPT(anchor),
      tools: { ls: lsTool, tree: treeTool, cat: catTool, grep: grepTool },
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
