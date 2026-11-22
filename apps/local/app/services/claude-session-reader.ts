import type { AgentSessionEntryContent } from "@cvm/core/features/agent-sessions/agent-session-entry";
import { toDate } from "@/packages/clock";

/**
 * Reads one Claude Code session file (its JSONL transcript) into the entries
 * of an Agent Session (GLOSSARY.md): what the session showed on screen, each
 * stamped with the wall-clock time it was written.
 *
 * ONLY THE KEPT BRANCH. A session is a tree: every message names its parent,
 * and a rewind (Escape-Escape, an edited prompt) starts a new branch from an
 * earlier message. What the screen ends on is the newest message's ancestry,
 * so that chain is kept and every other branch is dropped as abandoned.
 * Parallel tool calls split one reply over sibling messages, so the siblings
 * of the same reply, and the results that answer its calls, are pulled back
 * in.
 *
 * ONLY THE AGREED KINDS (`AgentSessionEntryContent`). Thinking, subagent
 * (sidechain) transcripts, `/clear`, local-command output, task notifications
 * and the meta messages a skill's body arrives in are dropped. A skill's body
 * and a tool's result are never read into an entry.
 *
 * PATHS NEVER REFUSE. Every path under the session's working directory is
 * rewritten relative to it, and the working directory itself becomes `.`. A
 * path outside it is kept, with its home directory (`/home/<user>`,
 * `/Users/<user>`) written as `~`. A `~/…` path is left as written: it may be
 * a TS path alias (`~/db`) as easily as a home path.
 *
 * PASTED CONTENT. A prompt's `<pasted_content …>` wrappers are dropped and the
 * text they wrap is kept.
 */

type SessionLine = {
  readonly type?: string;
  readonly uuid?: string;
  readonly parentUuid?: string | null;
  readonly logicalParentUuid?: string | null;
  readonly isSidechain?: boolean;
  readonly isMeta?: boolean;
  readonly sourceToolUseID?: string;
  readonly timestamp?: string;
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly message?: {
    readonly id?: string;
    readonly content?: string | ReadonlyArray<ContentBlock>;
  };
};

type ContentBlock = {
  readonly type: string;
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: Record<string, unknown>;
  readonly tool_use_id?: string;
  readonly is_error?: boolean;
  readonly content?: unknown;
};

export type ReadAgentSessionEntry = AgentSessionEntryContent & {
  /** When Claude Code wrote it, epoch ms. */
  readonly wallClockMs: number;
};

export type ReadClaudeSession = {
  readonly sourceSessionId: string;
  readonly cwd: string | null;
  readonly entries: ReadonlyArray<ReadAgentSessionEntry>;
  readonly dropped: {
    readonly offBranchMessages: number;
    readonly sidechainMessages: number;
    readonly thinkingBlocks: number;
    readonly systemMessages: number;
    readonly unreadableLines: number;
  };
  /** Reasons the whole upload must be refused, found while reading. */
  readonly problems: ReadonlyArray<string>;
};

/** How a skill's body starts when it arrives as a message of its own. */
const SKILL_BODY_PREFIX = "Base directory for this skill:";

const SYSTEM_TEXT =
  /^<(task-notification|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|system-reminder)/;

const blocksOf = (line: SessionLine): ReadonlyArray<ContentBlock> => {
  const content = line.message?.content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
};

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? (content as ContentBlock[])
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join("\n")
      : "";

const parseLines = (jsonl: string) => {
  let unreadable = 0;
  const lines: SessionLine[] = [];
  for (const raw of jsonl.split("\n")) {
    if (raw.trim() === "") continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object")
        lines.push(parsed as SessionLine);
      else unreadable++;
    } catch {
      unreadable++;
    }
  }
  return { lines, unreadable };
};

const isMessage = (line: SessionLine) =>
  (line.type === "user" || line.type === "assistant") &&
  typeof line.uuid === "string";

/** The newest message's chain of parents. */
const ancestryOfNewest = (
  messages: ReadonlyArray<SessionLine>,
  byUuid: ReadonlyMap<string, SessionLine>
): Set<string> => {
  const kept = new Set<string>();
  for (let at = messages.at(-1); at?.uuid && !kept.has(at.uuid);) {
    kept.add(at.uuid);
    const parent = at.parentUuid ?? at.logicalParentUuid;
    at = parent ? byUuid.get(parent) : undefined;
  }
  return kept;
};

/** Does `line` belong to a kept reply, or answer one of its tool calls? */
const belongsToKept = (
  line: SessionLine,
  replyIds: ReadonlySet<string | undefined>,
  toolUseIds: ReadonlySet<string>
): boolean => {
  if (line.type === "assistant") return replyIds.has(line.message?.id);
  const answersCall = blocksOf(line).some(
    (b) => b.type === "tool_result" && toolUseIds.has(b.tool_use_id ?? "")
  );
  const loadsCalledSkill =
    line.isMeta === true && toolUseIds.has(line.sourceToolUseID ?? "");
  return answersCall || loadsCalledSkill;
};

/**
 * The uuids of the kept branch: the newest message's ancestry, plus, to a
 * fixpoint, children of it that belong to the same reply or answer one of its
 * tool calls.
 */
const keptBranch = (
  messages: ReadonlyArray<SessionLine>,
  byUuid: ReadonlyMap<string, SessionLine>
): Set<string> => {
  const kept = ancestryOfNewest(messages, byUuid);
  for (let changed = true; changed;) {
    changed = false;
    const keptReplies = [...kept]
      .flatMap((u) => byUuid.get(u) ?? [])
      .filter((l) => l.type === "assistant");
    const toolUseIds = new Set(
      keptReplies
        .flatMap(blocksOf)
        .flatMap((b) => (b.type === "tool_use" && b.id ? [b.id] : []))
    );
    const replyIds = new Set(keptReplies.map((l) => l.message?.id));
    for (const line of messages) {
      const parent = line.parentUuid;
      if (kept.has(line.uuid!) || !parent || !kept.has(parent)) continue;
      if (belongsToKept(line, replyIds, toolUseIds)) {
        kept.add(line.uuid!);
        changed = true;
      }
    }
  }
  return kept;
};

/** One line of one input — the part a toolCall stub shows. */
const summarise = (tool: string, input: Record<string, unknown>) => {
  const first = (value: unknown) =>
    typeof value === "string" ? value.split("\n")[0]!.slice(0, 160) : null;
  switch (tool) {
    case "Bash":
      return first(input.description) ?? first(input.command);
    case "Read":
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return first(input.file_path);
    case "WebFetch":
      return first(input.url);
    case "WebSearch":
    case "ToolSearch":
      return first(input.query);
    case "Agent":
    case "Task":
      return first(input.description);
    case "Grep":
    case "Glob":
      return first(input.pattern);
    default:
      return null;
  }
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A character a path can go on with. */
const PATH_CHAR = `[^\\s"'\`)\\]>,;:|]`;

/** A home directory at the start of an absolute path. */
const HOME_DIR = new RegExp(
  `(?<![\\w.:/~-])/(?:home|Users)/[^/\\s"'\`)\\]>,;:|]+(?=/|(?!${PATH_CHAR}))`,
  "g"
);

/**
 * Every path in `value` as it may be shown to a learner: project-relative
 * under `cwd`, `.` for `cwd` itself, and `~` for the home directory of any
 * other absolute path.
 */
export const rewriteSessionPaths =
  (cwd: string | null) =>
  (value: string): string => {
    const root = cwd?.replace(/\/+$/, "") ?? "";
    const inProject =
      root === ""
        ? value
        : value
            // A path under the project: drop the project's prefix.
            .replace(
              new RegExp(
                `(?<![\\w.-])${escapeRegExp(root)}/(?=${PATH_CHAR})`,
                "g"
              ),
              ""
            )
            // The project itself, ending a sentence: `./` keeps the full stop
            // from reading as `..`.
            .replace(
              new RegExp(
                `(?<![\\w.-])${escapeRegExp(root)}/?(?=\\.(?!${PATH_CHAR}))`,
                "g"
              ),
              "./"
            )
            // The project itself.
            .replace(
              new RegExp(
                `(?<![\\w.-])${escapeRegExp(root)}/?(?![\\w-]|\\.${PATH_CHAR})`,
                "g"
              ),
              "."
            );
    return inProject.replace(HOME_DIR, "~");
  };

/** A prompt's `<pasted_content …>` wrappers, dropped for the text inside. */
const unwrapPastedContent = (text: string) =>
  text.replace(
    /<pasted_content\b[^>]*>\n?([\s\S]*?)\n?<\/pasted_content\b[^>]*>/g,
    "$1"
  );

type Relative = (value: string) => string;

type Counts = { thinkingBlocks: number; systemMessages: number };

/** One tool call as an entry: a skillCall for the Skill tool, else a stub. */
const toolUseEntry = (
  block: ContentBlock & { readonly name: string },
  results: ReadonlyMap<string, boolean>,
  relative: Relative
): AgentSessionEntryContent => {
  if (block.name === "Skill") {
    const args = block.input?.args;
    return {
      kind: "skillCall",
      via: "toolCall",
      skill: String(block.input?.skill ?? ""),
      args: typeof args === "string" && args !== "" ? relative(args) : null,
    };
  }
  const summary = summarise(block.name, block.input ?? {});
  return {
    kind: "toolCall",
    tool: block.name,
    summary: summary === null ? null : relative(summary),
    resultIsError: block.id ? (results.get(block.id) ?? null) : null,
  };
};

/** One assistant message's text blocks and tool calls, as entries. */
const assistantEntries = (
  line: SessionLine,
  results: ReadonlyMap<string, boolean>,
  relative: Relative,
  counts: Counts
): AgentSessionEntryContent[] =>
  blocksOf(line).flatMap((block): AgentSessionEntryContent[] => {
    if (block.type === "thinking" || block.type === "redacted_thinking") {
      counts.thinkingBlocks++;
      return [];
    }
    if (block.type === "text") {
      return block.text?.trim()
        ? [{ kind: "assistantText", text: relative(block.text) }]
        : [];
    }
    if (block.type !== "tool_use" || !block.name) return [];
    return [toolUseEntry({ ...block, name: block.name }, results, relative)];
  });

/** A slash command's prompt, and its skill when the next message loads one. */
const slashCommandEntries = (
  line: SessionLine,
  next: SessionLine | undefined,
  name: string,
  text: string,
  relative: Relative
): AgentSessionEntryContent[] => {
  const args = relative(
    (/<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1] ?? "").trim()
  );
  const prompt: AgentSessionEntryContent = {
    kind: "userPrompt",
    text: args ? `/${name} ${args}` : `/${name}`,
  };
  const loadsSkill =
    next?.type === "user" &&
    next.isMeta === true &&
    next.parentUuid === line.uuid &&
    !next.sourceToolUseID;
  return loadsSkill
    ? [
        prompt,
        {
          kind: "skillCall",
          via: "slashCommand",
          skill: name,
          args: args || null,
        },
      ]
    : [prompt];
};

/** One user message as entries, or a problem when it would store a skill body. */
const userEntries = (
  line: SessionLine,
  next: SessionLine | undefined,
  relative: Relative,
  counts: Counts
): { entries: AgentSessionEntryContent[]; problem?: string } => {
  const content = line.message?.content;
  // Tool results are folded into the calls they answer.
  if (
    Array.isArray(content) &&
    content.every((b: ContentBlock) => b.type === "tool_result")
  ) {
    return { entries: [] };
  }
  const text = textOf(content).trim();
  if (line.isMeta || SYSTEM_TEXT.test(text)) {
    counts.systemMessages++; // a skill's body, or other injected context
    return { entries: [] };
  }
  if (text === "") return { entries: [] };
  if (text.startsWith("[Request interrupted by user")) {
    return { entries: [{ kind: "interrupt", text }] };
  }
  const command = /<command-name>\/?([^<]+)<\/command-name>/.exec(text);
  if (command?.[1]?.trim() === "clear") {
    counts.systemMessages++;
    return { entries: [] };
  }
  if (command) {
    return {
      entries: slashCommandEntries(
        line,
        next,
        command[1]!.trim(),
        text,
        relative
      ),
    };
  }
  if (text.startsWith(SKILL_BODY_PREFIX)) {
    return {
      entries: [],
      problem: `a prompt at ${line.timestamp ?? "an unknown time"} is a skill's body, which is never stored`,
    };
  }
  return {
    entries: [
      { kind: "userPrompt", text: relative(unwrapPastedContent(text)) },
    ],
  };
};

/** Read a session file's text. Never throws: what it can't use is counted. */
export const readClaudeSession = (jsonl: string): ReadClaudeSession => {
  const { lines, unreadable } = parseLines(jsonl);
  const byUuid = new Map(
    lines.filter((l) => l.uuid).map((l) => [l.uuid!, l] as const)
  );
  const allMessages = lines.filter(isMessage);
  const messages = allMessages.filter((l) => !l.isSidechain);
  const kept = keptBranch(messages, byUuid);
  const onBranch = messages.filter((l) => kept.has(l.uuid!));

  const sourceSessionId =
    lines.find((l) => typeof l.sessionId === "string")?.sessionId ?? "";
  const cwd = onBranch.find((l) => typeof l.cwd === "string")?.cwd ?? null;
  const relative = rewriteSessionPaths(cwd);
  const problems: string[] =
    sourceSessionId === ""
      ? ["the file names no Claude Code session id: is it a session file?"]
      : [];

  const results = new Map<string, boolean>();
  for (const block of onBranch.flatMap(blocksOf)) {
    if (block.type === "tool_result" && block.tool_use_id) {
      results.set(block.tool_use_id, block.is_error === true);
    }
  }

  const counts: Counts = { thinkingBlocks: 0, systemMessages: 0 };
  const entries: ReadAgentSessionEntry[] = [];
  onBranch.forEach((line, i) => {
    const wallClockMs = toDate(line.timestamp ?? "").getTime();
    const read =
      line.type === "assistant"
        ? { entries: assistantEntries(line, results, relative, counts) }
        : userEntries(line, onBranch[i + 1], relative, counts);
    if (read.problem) problems.push(read.problem);
    if (!Number.isFinite(wallClockMs)) return;
    entries.push(...read.entries.map((entry) => ({ ...entry, wallClockMs })));
  });

  return {
    sourceSessionId,
    cwd,
    entries,
    dropped: {
      offBranchMessages: messages.length - onBranch.length,
      sidechainMessages: allMessages.length - messages.length,
      ...counts,
      unreadableLines: unreadable,
    },
    problems,
  };
};
