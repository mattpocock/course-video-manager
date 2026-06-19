import type { ReactNode } from "react";
import type { UIMessage } from "ai";
import { AIResponse } from "components/ui/kibo-ui/ai/response";
import { AlertCircle, Check, LoaderIcon, XCircle } from "lucide-react";
import { ApprovalCard, RejectedCard, InvalidEditLine } from "./approval-card";
import { CourseToolCall } from "./tool-call";
import type { ProposedOps, WriteResult } from "./types";
import {
  asVfsToolPart,
  asWriteToolPart,
  stringifyToolOutput,
  vfsToolIsStreaming,
  writeToolStreamingLabel,
} from "./tool-part-helpers";

export function AssistantPart({
  part,
  proposedOpsMap,
  isStreaming,
  addToolApprovalResponse,
}: {
  part: UIMessage["parts"][number];
  proposedOpsMap: Map<string, ProposedOps>;
  isStreaming: boolean;
  addToolApprovalResponse: (opts: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void;
}): ReactNode {
  if (part.type === "text") {
    return part.text ? (
      <AIResponse imageBasePath="" className="text-sm">
        {part.text}
      </AIResponse>
    ) : null;
  }

  if ((part as { type: string }).type === "data-proposed-ops") {
    return null;
  }

  const writeTool = asWriteToolPart(part);
  if (writeTool) {
    const proposed = proposedOpsMap.get(writeTool.toolCallId);

    if (writeTool.state === "approval-requested" && proposed) {
      return (
        <div className="my-3">
          <ApprovalCard
            proposed={proposed}
            disabled={isStreaming}
            onApprove={() =>
              addToolApprovalResponse({
                id: writeTool.approval!.id,
                approved: true,
              })
            }
            onReject={() =>
              addToolApprovalResponse({
                id: writeTool.approval!.id,
                approved: false,
                reason: "User rejected this edit.",
              })
            }
          />
        </div>
      );
    }

    if (writeTool.state === "output-available") {
      const result = writeTool.output as WriteResult | undefined;
      if (result?.applied === false) {
        return (
          <div className="my-2">
            <InvalidEditLine message={result.rejection.message} />
          </div>
        );
      }
      if (result?.applied === true) {
        return (
          <div className="my-2 flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Check className="size-3.5 text-green-600" />
            <span>Edit applied successfully.</span>
          </div>
        );
      }
    }

    if (writeTool.state === "output-denied") {
      if (proposed) {
        return (
          <div className="my-3">
            <RejectedCard proposed={proposed} />
          </div>
        );
      }
      return (
        <div className="my-2 flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <XCircle className="size-3.5" />
          <span>You rejected this edit.</span>
        </div>
      );
    }

    if (writeTool.state === "output-error") {
      return (
        <div className="my-2 flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          <span>{writeTool.errorText || "Tool execution failed."}</span>
        </div>
      );
    }

    const streamingLabel = writeToolStreamingLabel(
      writeTool.toolName,
      writeTool.state
    );
    if (streamingLabel) {
      return (
        <div className="my-2 flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <LoaderIcon className="size-3.5 animate-spin" />
          <span>{streamingLabel}</span>
        </div>
      );
    }
    return null;
  }

  const vfs = asVfsToolPart(part);
  if (!vfs) return null;
  const streaming = vfsToolIsStreaming(vfs.state);
  const pathArg = vfs.input?.path ?? vfs.input?.pattern ?? "";

  if (vfs.state === "output-error") {
    return (
      <div className="my-2 flex items-center gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <AlertCircle className="size-3.5 shrink-0" />
        <span>
          {`${vfs.toolName} ${pathArg}`.trim()}:{" "}
          {vfs.errorText || "Tool execution failed."}
        </span>
      </div>
    );
  }

  return (
    <CourseToolCall
      streaming={streaming}
      part={{
        type: "tool",
        tool: vfs.toolName,
        command: `${vfs.toolName} ${pathArg}`.trim(),
        output: streaming ? "" : stringifyToolOutput(vfs.output),
      }}
    />
  );
}
