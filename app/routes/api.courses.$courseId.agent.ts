import type {
  CourseAgentUIMessage,
  WriteResult,
  ProposedOps,
} from "@/features/course-agent/types";
import { runtimeLive } from "@/services/layer.server";
import {
  buildVfsForCourse,
  loadArchivedEntities,
} from "@/services/vfs/vfs-loader.server";
import { normalizePath, vfsLs, vfsTree, vfsCat, vfsGrep } from "@/services/vfs";
import { computeContentHash, deriveDiff } from "@/services/vfs";
import type { DiffContext, DiffInput } from "@/services/vfs";
import { executeOps } from "@/services/vfs/agent-diff-executor";
import { modelMessagesToDiffMessages } from "@/services/vfs/model-messages-adapter";
import {
  SEGMENT_KINDS,
  SEGMENT_KIND_DESCRIPTIONS,
} from "@/features/segments/segment-kinds";
import {
  ToolLoopAgent as Agent,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from "ai";
import { tool } from "ai";
import type { ModelMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { Console, Effect, Layer, Schema } from "effect";
import {
  DrizzleService,
  type DrizzleDB,
} from "@/services/drizzle-service.server";
import { data } from "react-router";
import { z } from "zod";

const requestSchema = Schema.Struct({
  messages: Schema.Any,
  versionId: Schema.optional(Schema.String),
});

const SEGMENT_KIND_GLOSSARY = SEGMENT_KINDS.map(
  (kind) => `\`${kind}\` (${SEGMENT_KIND_DESCRIPTIONS[kind].toLowerCase()})`
).join(", ");

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
    _members.json              # ordered list of section members
    <section>/
      section.json
      lessons/
        _members.json          # ordered list of lesson members
        <lesson>/
          lesson.json
          videos/
            _members.json      # ordered list of video members
            <video>/
              video.json
              segments/                     # only present when non-empty
                _members.json               # ordered segment manifest
                <NN>-<slug>.json            # individual segment leaf
              timeline/                     # only present when non-empty
                _members.json               # ordered timeline manifest (clips + chapters)
                <NN>.clip.json              # individual clip leaf
                <NN>-<slug>.chapter.json    # individual chapter leaf
\`\`\`

Every directory with children has a \`_members.json\` manifest: an ordered array of lightweight member objects (id + echo fields like slug/title/label). Use manifests for quick enumeration; read individual leaf files for full detail.

## Domain glossary
These terms name what you see in the VFS — keep them distinct:
- \`Ghost\` (\`[ghost]\` in listings, \`fsStatus: "ghost"\`, or section \`real: false\`): exists in planning but not yet recorded — nothing on disk. A ghost lesson is still a full workspace: it can own videos, segments, and a timeline. It is planned, not empty.
- \`Segment\` (\`segments/\`): one unit of the video's *plan*, written *before* recording. Segments are the *intended* structure. Each has a \`kind\` — the film-time job it does: ${SEGMENT_KIND_GLOSSARY}.
- \`Chapter\` (a \`.chapter.json\` in \`timeline/\`): a named divider in the *recorded* timeline that groups clips; maps 1:1 to a YouTube chapter. A chapter is not a segment — a segment is the plan, a chapter is what was actually shot.
- \`Clip\` (a \`.clip.json\` in \`timeline/\`): one span of recorded footage with its transcript \`text\`.
- \`segments/\` is the pre-recording plan; \`timeline/\` is the recorded video (clips and chapters interleaved in play order). Two separate views: "what I planned to shoot" vs "what I shot".
- \`authoringStatus\` (\`todo\`/\`done\`): how far a real lesson has progressed.

## Guidelines
- Use \`ls\` to list a directory, \`tree\` for a recursive overview, \`cat\` to read a file, and \`grep\` to search
- \`cat\` supports a \`filter\` argument for projecting array files (\`_members.json\`): \`.[i]\` (single item), \`.[i:j]\` (slice), \`count\` (item counts), \`.field\` (single field from object files)
- \`grep\` searches with case-insensitive regex. Omit \`path\` to search the current course; use \`/\` for all courses. Content mode reports locators that round-trip into \`cat path .[i]\`
- Answer questions about the course by navigating the VFS
- When you encounter an error (e.g. "No such file or directory"), adjust your path and try again
- Be concise in your answers
- Cite specific paths when referencing content`;

const editSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("replace"),
    old_text: z.string().describe("Exact text to find and replace"),
    new_text: z.string().describe("Replacement text"),
  }),
  z.object({
    type: z.literal("insert_after"),
    anchor: z.string().describe("Text to insert after"),
    new_text: z.string().describe("Text to insert"),
  }),
]);

export const action = async (args: {
  request: Request;
  params: Record<string, string | undefined>;
}) => {
  const body = await args.request.json();
  const courseId = args.params.courseId!;

  return Effect.gen(function* () {
    const parsed = yield* Schema.decodeUnknown(requestSchema)(body);
    const messages: CourseAgentUIMessage[] = parsed.messages;

    const db = (yield* DrizzleService) as unknown as DrizzleDB;

    const { root, anchor, repoVersionId } = yield* buildVfsForCourse(
      courseId,
      parsed.versionId
    );

    const archived = yield* loadArchivedEntities(db, repoVersionId);
    const diffCtx: DiffContext = { root, archived };

    let writer: UIMessageStreamWriter<CourseAgentUIMessage> | null = null;

    function runDiff(input: DiffInput, modelMessages: ModelMessage[]) {
      const diffMessages = modelMessagesToDiffMessages(modelMessages);
      return deriveDiff(input, diffMessages, diffCtx);
    }

    async function applyOrReject(
      input: DiffInput,
      modelMessages: ModelMessage[]
    ): Promise<WriteResult> {
      const freshVfs = await buildVfsForCourse(courseId, parsed.versionId).pipe(
        Effect.provide(Layer.succeed(DrizzleService, db as any)),
        Effect.runPromise
      );

      const freshArchived = await loadArchivedEntities(
        db,
        freshVfs.repoVersionId
      ).pipe(Effect.runPromise);

      const freshCtx: DiffContext = {
        root: freshVfs.root,
        archived: freshArchived,
      };
      const diffMessages = modelMessagesToDiffMessages(modelMessages);
      const res = deriveDiff(input, diffMessages, freshCtx);

      if (!res.ok) {
        return { applied: false, rejection: res.rejection };
      }

      return executeOps(res.ops, {
        db,
        courseId,
        repoVersionId: freshVfs.repoVersionId,
        filePath: freshVfs.filePath,
        root: freshVfs.root,
        path: input.path,
      }).pipe(Effect.runPromise);
    }

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
        "Read a leaf file's JSON content. Returns {content, path, hash}. Supports an optional filter for projecting array files: `.[i]` (item at index), `.[i:j]` (slice), `count` (item counts), `.field` (single field from object files).",
      inputSchema: z.object({
        path: z.string().describe("The file path to read."),
        filter: z
          .string()
          .optional()
          .describe("Projection filter: .[i], .[i:j], count, or .field"),
      }),
      execute: async ({ path, filter }) => {
        const absolute = normalizePath(path, anchor);
        const content = vfsCat(root, absolute, filter);
        return { content, path: absolute, hash: computeContentHash(content) };
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

    const writeTool = tool({
      description:
        "Write the complete content of a VFS file. Use for small files like _members.json, section.json, lesson.json, video.json. You must cat the file first before writing.",
      inputSchema: z.object({
        path: z.string().describe("The VFS file path to write."),
        content: z.string().describe("The complete JSON content of the file."),
      }),
      needsApproval: (
        input: { path: string; content: string },
        { toolCallId, messages: modelMessages }
      ) => {
        try {
          const absolute = normalizePath(input.path, anchor);
          const diffInput: DiffInput = {
            path: absolute,
            content: input.content,
          };
          const res = runDiff(diffInput, modelMessages);
          if (!res.ok) return false;

          const proposed: ProposedOps = {
            toolCallId,
            path: absolute,
            tool: "write",
            ops: res.ops,
            ...(res.note ? { note: res.note } : {}),
          };
          writer?.write({
            type: "data-proposed-ops",
            id: toolCallId,
            data: proposed,
          });
          return true;
        } catch {
          return false;
        }
      },
      execute: async (
        input: { path: string; content: string },
        { messages: modelMessages }
      ): Promise<WriteResult> => {
        const absolute = normalizePath(input.path, anchor);
        return applyOrReject(
          { path: absolute, content: input.content },
          modelMessages
        );
      },
    });

    const editTool = tool({
      description:
        "Apply targeted edits to a VFS file using replace/insert_after operations. Use for large files where rewriting the whole content would be wasteful. You must cat the file first before editing.",
      inputSchema: z.object({
        path: z.string().describe("The VFS file path to edit."),
        edits: z
          .array(editSchema)
          .describe("Array of edit operations to apply in sequence."),
      }),
      needsApproval: (
        input: { path: string; edits: z.infer<typeof editSchema>[] },
        { toolCallId, messages: modelMessages }
      ) => {
        try {
          const absolute = normalizePath(input.path, anchor);
          const diffInput: DiffInput = { path: absolute, edits: input.edits };
          const res = runDiff(diffInput, modelMessages);
          if (!res.ok) return false;

          const proposed: ProposedOps = {
            toolCallId,
            path: absolute,
            tool: "edit",
            ops: res.ops,
            ...(res.note ? { note: res.note } : {}),
          };
          writer?.write({
            type: "data-proposed-ops",
            id: toolCallId,
            data: proposed,
          });
          return true;
        } catch {
          return false;
        }
      },
      execute: async (
        input: { path: string; edits: z.infer<typeof editSchema>[] },
        { messages: modelMessages }
      ): Promise<WriteResult> => {
        const absolute = normalizePath(input.path, anchor);
        return applyOrReject(
          { path: absolute, edits: input.edits },
          modelMessages
        );
      },
    });

    const modelMessages = yield* Effect.tryPromise(() =>
      convertToModelMessages(messages)
    );

    const agent = new Agent({
      model: anthropic("claude-sonnet-4-5"),
      instructions: SYSTEM_PROMPT(anchor),
      tools: {
        ls: lsTool,
        tree: treeTool,
        cat: catTool,
        grep: grepTool,
        write: writeTool,
        edit: editTool,
      },
    });

    const stream = createUIMessageStream<CourseAgentUIMessage>({
      originalMessages: messages,
      execute: async ({ writer: w }) => {
        writer = w;

        const result = await agent.stream({ messages: modelMessages });
        writer.merge(
          result.toUIMessageStream({
            originalMessages: messages,
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
          })
        );
      },
    });

    return createUIMessageStreamResponse({ stream });
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
