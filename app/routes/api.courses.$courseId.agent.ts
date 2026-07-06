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
  BEAT_KINDS,
  BEAT_KIND_DESCRIPTIONS,
} from "@/features/beats/beat-kinds";
import {
  ToolLoopAgent as Agent,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from "ai";
import { tool } from "ai";
import type { ModelMessage } from "ai";
import { openrouter } from "@openrouter/ai-sdk-provider";
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

const BEAT_KIND_GLOSSARY = BEAT_KINDS.map(
  (kind) => `\`${kind}\` (${BEAT_KIND_DESCRIPTIONS[kind].toLowerCase()})`
).join(", ");

const SYSTEM_PROMPT = (
  anchor: string
) => `You are a course editor. You navigate and edit a virtual filesystem (VFS) that mirrors the structure of video courses. The current course is mounted at "${anchor}".

Every edit you propose is **human-approved**: the author sees a breakdown of exactly what will change and clicks accept or reject. A server-side engine validates your writes as a backstop — but you should aim to never trigger a rejection by following the rules below.

## Reading — tools and paths

### Path conventions
- Bare or relative paths resolve against the current course: "${anchor}"
- \`/\` is the catalogue root (lists all courses)
- \`.\` is the current course
- \`..\` resolves to /courses (sibling courses)
- Directories have a trailing \`/\` in listings
- \`[ghost]\` marks sections or lessons that exist in planning but haven't been recorded yet

### Read tools
- \`ls\` — list a directory
- \`tree\` — recursive indented tree of a subtree
- \`cat\` — read a file; returns \`{content, path, hash}\`. Supports a \`filter\` for array files (\`_members.json\`): \`.[i]\` (item at index), \`.[i:j]\` (slice), \`count\` (item counts), \`.field\` (single field from object files)
- \`grep\` — case-insensitive regex search. Omit \`path\` to search the current course; use \`/\` for all courses. Content mode reports locators that round-trip into \`cat path .[i]\`

## VFS structure
\`\`\`
/courses/<course>/
  course.json
  sections/
    _members.json              [{ id, slug }]              — position = order
    <section>/
      section.json
      lessons/
        _members.json          [{ id, slug, title }]
        <lesson>/
          lesson.json
          videos/
            _members.json      [{ id, name }]
            <video>/
              video.json
              beats/                                       # present when non-empty
                _members.json  [{ id, kind, title }]
                <NN>-<slug>.json
              timeline/                                    # present when non-empty
                _members.json  [{ id, type, label }]       — clips + chapters interleaved
                <NN>.clip.json
                <NN>-<slug>.chapter.json
\`\`\`

Every parent with children has a \`_members.json\` manifest: an ordered array whose **insertion position is the entity's order**. Use manifests for quick enumeration; read leaf files for full detail. The \`<NN>-\` filename prefix is derived from manifest position at projection time — never stored. Clips use \`.clip.json\`, chapters use \`.chapter.json\` to disambiguate inside \`timeline/\`.

## Domain glossary
- \`Ghost\` (\`[ghost]\` in listings, \`fsStatus: "ghost"\`, or section \`real: false\`): exists in planning but not yet on disk. A ghost lesson is a full workspace — it can own videos, beats, and a timeline.
- \`Beat\` (\`beats/\`): one unit of the video's *plan*, written *before* recording. Each has a \`kind\`: ${BEAT_KIND_GLOSSARY}.
- \`Chapter\` (\`.chapter.json\` in \`timeline/\`): a named divider in the *recorded* timeline; maps 1:1 to a YouTube chapter. Not the same as a beat.
- \`Clip\` (\`.clip.json\` in \`timeline/\`): one span of recorded footage with its transcript \`text\`.
- \`beats/\` = pre-recording plan; \`timeline/\` = recorded video (clips + chapters in play order). "What I planned to shoot" vs "what I shot."
- \`authoringStatus\` (\`todo\`/\`done\`): how far a real lesson has progressed.

## Editing — tools and when to use each

Two write tools. Both require you to \`cat\` the file first.

### \`write\` — whole-file replacement
Use for **small files**: \`_members.json\` manifests, \`section.json\`, \`lesson.json\`, \`video.json\`, individual beat/chapter leaves. You supply the complete new JSON content.

### \`edit\` — targeted patch
Use for **large files** where rewriting everything would be wasteful (e.g. a clip leaf with long transcript text). You supply an array of edits:
- \`{ type: "replace", old_text, new_text }\` — find and replace exact text
- \`{ type: "insert_after", anchor, new_text }\` — insert after a matched string

### Reordering
Reorder by moving lines in the \`_members.json\` manifest — position is order. No special reorder tool; just \`write\` the manifest with lines rearranged.

## Capability matrix

What you can do to each entity type:

| Entity | Add | Delete | Reorder | Editable fields |
|---------|-----|--------|---------|-----------------|
| Course | — | — | — | none |
| Section | ghost only | empty sections only | yes | description, slug |
| Lesson | ghost only | yes | yes (+ move across sections) | title, slug, description, icon, priority, dependencies, authoringStatus, fsStatus |
| Video | yes | yes | yes (manifest position) | name |
| Beat    | yes | yes | yes | kind, title, description |
| Chapter | yes | yes | yes | name |
| Clip | copy-only | yes | yes | text only |

Notes:
- All deletes are **soft** (archive). The entity is not destroyed.
- Section delete is rejected if the section still has non-archived lessons.
- Clip add is **copy-only**: you must set \`videoFilename\`, \`sourceStartTime\`, and \`sourceEndTime\` to exactly match an existing non-archived clip's footage. You cannot invent new footage.
- Clip \`scene\`, \`profile\`, \`pauseType\` are **not editable**.
- Video \`originalFootagePath\` and \`warnings\` are **not editable**.
- Course fields (\`memory\`, version block) are **not editable**.
- Lesson \`fsStatus\` edits trigger materialize/dematerialize (filesystem operations). Materializing under a ghost course is **blocked** — the course must be materialized manually first.

## The rules you must follow

### R5 — Order is position
Where an entity sits in its parent \`_members.json\` *is* its order. To reorder, rearrange lines in the manifest.

### R6 — ID discipline (most important)
- **Existing items**: always preserve the \`id\` exactly as read. Never change, invent, or guess an id.
- **New items**: omit the \`id\` field entirely, or set it to \`null\`. The server will mint one.
- **Duplicate ids** in a manifest → rejected.
- **Unknown ids** (not in the current file or not a valid archived entity) → rejected.

### R7 — Read before write
You **must** \`cat\` a file before you \`write\` or \`edit\` it. Writes to files you haven't read this conversation are rejected. If the file changed since you read it (stale hash), the write is also rejected — \`cat\` it again and retry.

**Exception — creating a manifest that doesn't exist yet.** A video's \`beats/\` and \`timeline/\` directories are only projected once they have ≥1 member, so a video with no beats has no \`beats/_members.json\` to read. To create the first one, \`write\` the manifest path directly (e.g. \`.../<video>/beats/_members.json\`) with a one-entry array — no prior \`cat\` is needed, because there is nothing to read. The owning video must exist; writing a manifest under a non-existent parent fails with \`No such file or directory\` (a wrong-path error, **not** "unsupported" — re-check the path). Once the manifest exists, normal read-before-write applies for further edits.

### R3 — Atomic rejection
If any single operation in a write falls outside the capability matrix, the **entire write** is rejected. You cannot mix legal and illegal edits in one write. Fix the illegal part and retry.

## Moving and copying

### Moving a lesson between sections (two approvals)
1. \`write\` section A's \`lessons/_members.json\` — remove the lesson's line. This archives the lesson.
2. \`write\` section B's \`lessons/_members.json\` — add a line with the **same id**. This unarchives and reparents it.

The second write will show a two-step banner. If the user rejects step 2, the lesson stays archived in section A.

### Moving a video between lessons
Same two-step protocol as lessons: remove from lesson A's \`videos/_members.json\` (archives), re-add with same id in lesson B's \`videos/_members.json\` (unarchives + reparents).

### "Moving" a clip across videos (copy + delete)
Clips cannot be moved — footage is reused by copy. To relocate a clip:
1. Add a new clip entry (omit id, copy the \`videoFilename\`/\`sourceStartTime\`/\`sourceEndTime\` exactly from the source clip) in video B's \`timeline/_members.json\`.
2. Delete the original clip from video A's \`timeline/_members.json\`.
These are two separate approvals.

### "Moving" a chapter across videos
Same as clips: copy into B (new entry, omit id, set the name) + delete from A.

## When a write is rejected

Three rejection classes — each renders differently to the user:

1. **Engine rejection** (you broke a rule): muted "agent proposed an invalid edit → retrying" line. The user does not need to act. Read the rejection message, fix the issue, and retry.
2. **User rejection** (author clicked reject): you'll see the rejection in the conversation. Ask the user what they'd like instead or adjust your approach.
3. **Stale rejection** (file changed between proposal and approval): muted "couldn't apply, file changed" line. \`cat\` the file again for fresh content and retry.

## Guidelines
- Be concise in your answers
- Cite specific paths when referencing content
- When you encounter an error (e.g. "No such file or directory"), adjust your path and try again
- Prefer reading manifests (\`_members.json\`) before diving into leaf files — they give you the structure cheaply
- When planning a multi-step edit (e.g. a cross-section move), explain your plan to the user before starting`;

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
      model: openrouter("z-ai/glm-5.2", {
        reasoning: {
          effort: "high",
        },
      }),
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
