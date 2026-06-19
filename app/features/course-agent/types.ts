import type { UIMessage } from "ai";
import type { Op } from "@/services/vfs/derive-diff-types";

export type WriteResult =
  | { applied: true; content: string; hash: string; renames: string[] }
  | { applied: false; rejection: { kind: string; message: string } };

export type ProposedOps = {
  toolCallId: string;
  path: string;
  tool: "write" | "edit";
  ops: Op[];
  note?: string;
};

export type CourseAgentDataParts = {
  "proposed-ops": ProposedOps;
};

export type CourseAgentUIMessage = UIMessage<unknown, CourseAgentDataParts>;

export function courseAgentSendAutomaticallyWhen({
  messages,
}: {
  messages: UIMessage[];
}): boolean {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== "assistant") return false;

  const toolParts = lastMessage.parts.filter(
    (p) => p.type.startsWith("tool-") || p.type === "dynamic-tool"
  ) as Array<{ state?: string }>;

  if (toolParts.length === 0) return false;

  return toolParts.every((p) => {
    const state = p.state;
    return (
      state === "output-available" ||
      state === "output-error" ||
      state === "output-denied"
    );
  });
}
