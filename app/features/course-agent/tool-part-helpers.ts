import type { UIMessage } from "ai";

const VFS_TOOLS = ["ls", "tree", "cat", "grep"] as const;
type VfsToolName = (typeof VFS_TOOLS)[number];

function isVfsTool(name: string): name is VfsToolName {
  return (VFS_TOOLS as readonly string[]).includes(name);
}

export type NormalizedVfsToolPart = {
  toolName: VfsToolName;
  state: string;
  input: Record<string, string> | undefined;
  output: unknown;
};

export function asVfsToolPart(
  part: UIMessage["parts"][number]
): NormalizedVfsToolPart | null {
  let toolName: string | undefined;
  if (part.type === "dynamic-tool") {
    toolName = part.toolName;
  } else if (part.type.startsWith("tool-")) {
    toolName = part.type.slice("tool-".length);
  }
  if (!toolName || !isVfsTool(toolName)) return null;

  const p = part as {
    state?: string;
    input?: Record<string, string>;
    output?: unknown;
  };
  return {
    toolName,
    state: p.state ?? "",
    input: p.input,
    output: p.output,
  };
}

const WRITE_TOOLS = ["write", "edit"] as const;

export type NormalizedWriteToolPart = {
  toolName: "write" | "edit";
  toolCallId: string;
  state: string;
  input: Record<string, unknown> | undefined;
  output: unknown;
  approval?: { id: string; approved?: boolean; reason?: string };
};

export function asWriteToolPart(
  part: UIMessage["parts"][number]
): NormalizedWriteToolPart | null {
  let toolName: string | undefined;
  if (part.type === "tool-write") toolName = "write";
  else if (part.type === "tool-edit") toolName = "edit";
  else if (part.type === "dynamic-tool") {
    const dyn = part as { toolName?: string };
    if (dyn.toolName === "write" || dyn.toolName === "edit")
      toolName = dyn.toolName;
  }
  if (!toolName || !(WRITE_TOOLS as readonly string[]).includes(toolName))
    return null;

  const p = part as {
    toolCallId?: string;
    state?: string;
    input?: Record<string, unknown>;
    output?: unknown;
    approval?: { id: string; approved?: boolean; reason?: string };
  };
  if (!p.toolCallId) return null;

  return {
    toolName: toolName as "write" | "edit",
    toolCallId: p.toolCallId,
    state: p.state ?? "",
    input: p.input,
    output: p.output,
    approval: p.approval,
  };
}

export function stringifyToolOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  if (typeof output === "object") {
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  }
  return String(output);
}

const TERMINAL_STATES = new Set([
  "output-available",
  "output-error",
  "output-denied",
]);

export function vfsToolIsStreaming(state: string): boolean {
  return !TERMINAL_STATES.has(state);
}

const STREAMING_STATES = new Set(["input-streaming", "input-available"]);

export function writeToolStreamingLabel(
  toolName: "write" | "edit",
  state: string
): string | null {
  if (STREAMING_STATES.has(state)) {
    return toolName === "write" ? "Writing…" : "Editing…";
  }
  if (state === "approval-responded") {
    return "Applying changes…";
  }
  return null;
}

export function extractUsageFromMessage(
  message: UIMessage
): { inputTokens: number; outputTokens: number } | null {
  const meta = message.metadata as
    | { usage?: { inputTokens?: number; outputTokens?: number } }
    | undefined;
  if (meta?.usage?.inputTokens != null) {
    return {
      inputTokens: meta.usage.inputTokens,
      outputTokens: meta.usage.outputTokens ?? 0,
    };
  }
  return null;
}
