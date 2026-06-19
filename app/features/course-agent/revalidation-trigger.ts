import type { UIMessage } from "ai";
import type { WriteResult } from "./types";

type ToolPartLike = {
  type: string;
  state?: string;
  toolCallId?: string;
  output?: unknown;
};

export function findAppliedToolCallIds(messages: UIMessage[]): Set<string> {
  const applied = new Set<string>();
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.parts) {
      const p = part as ToolPartLike;
      if (
        (p.type === "tool-write" || p.type === "tool-edit") &&
        p.state === "output-available" &&
        p.toolCallId
      ) {
        const result = p.output as WriteResult | undefined;
        if (result?.applied === true) {
          applied.add(p.toolCallId);
        }
      }
    }
  }
  return applied;
}
