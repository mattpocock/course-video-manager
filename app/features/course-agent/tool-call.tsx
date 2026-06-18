// Tool-call display for the Course Agent panel. Reuses the write page's kibo `AITool`
// collapsible primitives, but with a per-tool lucide icon pinned to the TOP of the row
// (not vertically centred) so multi-line commands read cleanly.

import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { AITool, AIToolContent } from "components/ui/kibo-ui/ai/tool";
import {
  ChevronDownIcon,
  FileText,
  FolderOpen,
  ListTree,
  Search,
  type LucideIcon,
} from "lucide-react";
export type ToolName = "ls" | "tree" | "cat" | "grep";

export type ToolPart = {
  type: "tool";
  tool: ToolName;
  command: string;
  output: string;
  touched: string[];
};

const TOOL_ICON: Record<ToolName, LucideIcon> = {
  ls: FolderOpen,
  tree: ListTree,
  cat: FileText,
  grep: Search,
};

export function CourseToolCall({ part }: { part: ToolPart }) {
  const Icon = TOOL_ICON[part.tool];
  return (
    <AITool className="mb-2 w-full">
      <CollapsibleTrigger className="group flex w-full items-start gap-2 p-3 text-left">
        {/* mt-0.5 nudges the icon onto the first text line — align-top, not -middle */}
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
          {part.command}
        </code>
        <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
          {part.touched.length} path{part.touched.length === 1 ? "" : "s"}
        </span>
        <ChevronDownIcon
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            "group-data-[state=open]:rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <AIToolContent>
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">
          {part.output}
        </pre>
      </AIToolContent>
    </AITool>
  );
}
