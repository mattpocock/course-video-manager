import type { UIMessage } from "ai";
import { asVfsToolPart, asWriteToolPart } from "./tool-part-helpers";

export function formatTranscript(messages: UIMessage[]): string {
  const blocks: string[] = [];

  for (const msg of messages) {
    const label = msg.role === "user" ? "User" : "Assistant";
    const lines: string[] = [];

    for (const part of msg.parts) {
      if (part.type === "text" && part.text) {
        lines.push(part.text);
        continue;
      }

      const vfs = asVfsToolPart(part);
      if (vfs) {
        const pathArg = vfs.input?.path ?? vfs.input?.pattern ?? "";
        lines.push(`[Tool: ${vfs.toolName} ${pathArg}]`.trim());
        continue;
      }

      const write = asWriteToolPart(part);
      if (write) {
        const pathArg =
          (write.input?.path as string | undefined) ??
          (write.input?.filePath as string | undefined) ??
          "";
        lines.push(`[Tool: ${write.toolName} ${pathArg}]`.trim());
        continue;
      }
    }

    if (lines.length > 0) {
      blocks.push(`${label}:\n${lines.join("\n")}`);
    }
  }

  return blocks.join("\n\n");
}
