import type { ModelMessage, ToolResultPart } from "ai";
import type { DiffMessage } from "./derive-diff-types";

function unwrapOutput(output: ToolResultPart["output"]): unknown {
  if (output && typeof output === "object" && "type" in output) {
    if (output.type === "json" || output.type === "text") {
      return (output as { value: unknown }).value;
    }
  }
  return output;
}

export function modelMessagesToDiffMessages(
  messages: ModelMessage[]
): DiffMessage[] {
  return messages.map((msg) => {
    if (msg.role === "tool") {
      return {
        role: "tool",
        content: msg.content.map((part) => {
          if (part.type === "tool-result") {
            return {
              type: "tool-result" as const,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              result: unwrapOutput(part.output),
            };
          }
          return { type: part.type };
        }),
      };
    }
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }
    return {
      role: msg.role,
      content: (
        msg.content as Array<{ type: string; [k: string]: unknown }>
      ).map((part) => ({ ...part })),
    };
  });
}
