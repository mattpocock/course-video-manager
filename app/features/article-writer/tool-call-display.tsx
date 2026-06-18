import { memo, useCallback, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronRightIcon,
  FileTextIcon,
  PencilIcon,
  ReplaceIcon,
  PlusIcon,
  RefreshCwIcon,
  CheckCircleIcon,
  LoaderIcon,
  XCircleIcon,
  Undo2Icon,
  Redo2Icon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { applyEdits, type DocumentEdit } from "./document-editing-engine";

type EditInput = {
  type?: string;
  old_text?: string;
  anchor?: string;
  new_text?: string;
  message?: string;
};

type ToolCallPart = {
  type: string;
  toolCallId?: string;
  state?: string;
  output?: unknown;
  input?: {
    content?: string;
    edits?: (EditInput | undefined)[];
  };
};

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "…";
}

type DiffLine = { type: "same" | "add" | "remove"; text: string };

/**
 * Compute a line-level unified diff between two strings using LCS.
 */
function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: "same", text: oldLines[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.push({ type: "add", text: newLines[j - 1]! });
      j--;
    } else {
      result.push({ type: "remove", text: oldLines[i - 1]! });
      i--;
    }
  }
  return result.reverse();
}

function UnifiedDiff({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}) {
  const lines = computeLineDiff(oldText, newText);
  // Truncate display if too many lines
  const maxLines = 60;
  const truncated = lines.length > maxLines;
  const displayLines = truncated ? lines.slice(0, maxLines) : lines;

  return (
    <div className="rounded-md border border-border overflow-hidden font-mono text-xs leading-relaxed">
      {displayLines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "px-2 whitespace-pre-wrap break-words",
            line.type === "remove" && "bg-red-500/10 text-red-300",
            line.type === "add" && "bg-green-500/10 text-green-300",
            line.type === "same" && "text-muted-foreground"
          )}
        >
          <span className="select-none inline-block w-4 mr-1 text-muted-foreground/50">
            {line.type === "remove" ? "−" : line.type === "add" ? "+" : " "}
          </span>
          {line.text || " "}
        </div>
      ))}
      {truncated && (
        <div className="px-2 py-1 text-muted-foreground/50 italic">
          …{lines.length - maxLines} more lines
        </div>
      )}
    </div>
  );
}

const editTypeConfig = {
  replace: {
    label: "Replace",
    icon: ReplaceIcon,
    color: "text-amber-500",
  },
  insert_after: {
    label: "Insert",
    icon: PlusIcon,
    color: "text-blue-500",
  },
  rewrite: {
    label: "Rewrite",
    icon: RefreshCwIcon,
    color: "text-purple-500",
  },
} as const;

function StatusIcon({ state, failed }: { state?: string; failed: boolean }) {
  if (failed) {
    return <XCircleIcon className="size-3.5 text-red-500" />;
  }
  if (state === "output-available") {
    return <CheckCircleIcon className="size-3.5 text-green-500" />;
  }
  return <LoaderIcon className="size-3.5 text-muted-foreground animate-spin" />;
}

/**
 * Build a reverse DocumentEdit that undoes the given edit.
 * Returns undefined for edits that can't be reversed (e.g. rewrite with no prior state).
 */
function buildReverseEdit(edit: EditInput): DocumentEdit | undefined {
  if (edit.type === "replace" && edit.old_text && edit.new_text) {
    return {
      type: "replace",
      old_text: edit.new_text,
      new_text: edit.old_text,
    };
  }
  if (edit.type === "insert_after" && edit.new_text) {
    return { type: "replace", old_text: edit.new_text, new_text: "" };
  }
  // "rewrite" can't be reversed without knowing the previous document
  return undefined;
}

/**
 * Build a forward DocumentEdit that re-applies the given edit.
 */
function buildForwardEdit(edit: EditInput): DocumentEdit | undefined {
  if (edit.type === "replace" && edit.old_text && edit.new_text) {
    return {
      type: "replace",
      old_text: edit.old_text,
      new_text: edit.new_text,
    };
  }
  if (edit.type === "insert_after" && edit.anchor && edit.new_text) {
    return {
      type: "insert_after",
      anchor: edit.anchor,
      new_text: edit.new_text,
    };
  }
  return undefined;
}

function EditItem({
  edit,
  isReverted,
  onRevert,
  onRestore,
  canRevert,
}: {
  edit: EditInput;
  isReverted: boolean;
  onRevert?: () => void;
  onRestore?: () => void;
  canRevert: boolean;
}) {
  const [open, setOpen] = useState(false);
  const editType = edit.type as keyof typeof editTypeConfig | undefined;
  const config =
    (editType && editTypeConfig[editType]) || editTypeConfig.replace;
  const Icon = config.icon;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex w-full items-center gap-1">
        <CollapsibleTrigger className="flex flex-1 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50 transition-colors">
          <ChevronRightIcon
            className={cn(
              "size-3 text-muted-foreground transition-transform shrink-0",
              open && "rotate-90"
            )}
          />
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              isReverted ? "text-muted-foreground/50" : config.color
            )}
          />
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-1.5 py-0 font-mono",
              isReverted && "opacity-50"
            )}
          >
            {config.label}
          </Badge>
          <span
            className={cn(
              "text-muted-foreground truncate text-left",
              isReverted && "line-through opacity-50"
            )}
          >
            {edit.message
              ? edit.message
              : edit.type === "replace" &&
                  typeof edit.old_text === "string" &&
                  edit.old_text
                ? truncate(edit.old_text.split("\n")[0] ?? "", 60)
                : edit.type === "insert_after" &&
                    typeof edit.anchor === "string" &&
                    edit.anchor
                  ? `after "${truncate(edit.anchor.split("\n")[0] ?? "", 50)}"`
                  : "Full document"}
          </span>
        </CollapsibleTrigger>
        {canRevert && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              isReverted ? onRestore?.() : onRevert?.();
            }}
          >
            {isReverted ? (
              <>
                <Redo2Icon className="size-3 mr-1" />
                Restore
              </>
            ) : (
              <>
                <Undo2Icon className="size-3 mr-1" />
                Revert
              </>
            )}
          </Button>
        )}
      </div>
      <CollapsibleContent>
        <div
          className={cn("ml-5 mr-2 mb-2 space-y-2", isReverted && "opacity-40")}
        >
          {edit.type === "replace" &&
            typeof edit.old_text === "string" &&
            edit.old_text &&
            typeof edit.new_text === "string" &&
            edit.new_text && (
              <UnifiedDiff oldText={edit.old_text} newText={edit.new_text} />
            )}
          {edit.type === "insert_after" && (
            <>
              {typeof edit.anchor === "string" && edit.anchor && (
                <div className="rounded-md border border-muted bg-muted/30 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 font-medium">
                    After
                  </div>
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono leading-relaxed">
                    {truncate(edit.anchor, 300)}
                  </pre>
                </div>
              )}
              {typeof edit.new_text === "string" && edit.new_text && (
                <div className="rounded-md border border-green-500/20 bg-green-500/5 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-green-400 mb-1 font-medium">
                    Add
                  </div>
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono leading-relaxed">
                    {truncate(edit.new_text, 500)}
                  </pre>
                </div>
              )}
            </>
          )}
          {edit.type === "rewrite" &&
            typeof edit.new_text === "string" &&
            edit.new_text && (
              <div className="rounded-md border border-green-500/20 bg-green-500/5 p-2">
                <div className="text-[10px] uppercase tracking-wide text-green-400 mb-1 font-medium">
                  New content
                </div>
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono leading-relaxed">
                  {truncate(edit.new_text, 500)}
                </pre>
              </div>
            )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export const WriteDocumentDisplay = memo(function WriteDocumentDisplay({
  part,
}: {
  part: ToolCallPart;
}) {
  const [open, setOpen] = useState(false);
  const isStreaming =
    part.state !== "output-available" && part.state !== "error";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors w-full">
        <ChevronRightIcon
          className={cn(
            "size-3.5 text-muted-foreground transition-transform shrink-0",
            open && "rotate-90"
          )}
        />
        <FileTextIcon className="size-3.5 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground font-medium">
          {isStreaming ? "Writing document…" : "Wrote document"}
        </span>
        <StatusIcon state={part.state} failed={false} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-5 mr-2 mb-2">
          {typeof part.input?.content === "string" && part.input.content ? (
            <div className="rounded-md border border-muted bg-muted/30 p-2">
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-y-auto">
                {truncate(part.input.content, 800)}
              </pre>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground italic px-2">
              Document content not available
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

export const EditDocumentDisplay = memo(function EditDocumentDisplay({
  part,
  documentRef,
  updateDocument,
}: {
  part: ToolCallPart;
  documentRef?: React.RefObject<string | undefined>;
  updateDocument?: (content: string) => void;
}) {
  const hasMessages = (part.input?.edits ?? []).some(
    (e) => e != null && e.message
  );
  const [open, setOpen] = useState(hasMessages);
  const [revertedEdits, setRevertedEdits] = useState<Set<number>>(new Set());
  const edits = (part.input?.edits ?? []).filter(
    (e): e is EditInput => e != null
  );
  const editCount = edits.length;
  const isStreaming =
    part.state !== "output-available" && part.state !== "error";
  const result = part.state === "output-available" ? part.output : undefined;
  const failed = typeof result === "string" && !result.includes("successfully");
  const isComplete = part.state === "output-available" && !failed;
  const canRevert = isComplete && !!documentRef && !!updateDocument;

  // Edits that can be individually reverted (not "rewrite")
  const revertableEdits = edits
    .map((edit, i) => ({ edit, index: i }))
    .filter(({ edit }) => edit.type !== "rewrite");
  const allReverted =
    revertableEdits.length > 0 &&
    revertableEdits.every(({ index }) => revertedEdits.has(index));
  const someReverted = revertableEdits.some(({ index }) =>
    revertedEdits.has(index)
  );

  const applyEditToDocument = useCallback(
    (editToApply: DocumentEdit) => {
      if (!documentRef || !updateDocument) return;
      const currentDoc = documentRef.current ?? "";
      const result = applyEdits(currentDoc, [editToApply]);
      if ("document" in result) {
        updateDocument(result.document);
      }
    },
    [documentRef, updateDocument]
  );

  const handleRevertEdit = useCallback(
    (index: number) => {
      const edit = edits[index];
      if (!edit) return;
      const reverseEdit = buildReverseEdit(edit);
      if (!reverseEdit) return;
      applyEditToDocument(reverseEdit);
      setRevertedEdits((prev) => new Set(prev).add(index));
    },
    [edits, applyEditToDocument]
  );

  const handleRestoreEdit = useCallback(
    (index: number) => {
      const edit = edits[index];
      if (!edit) return;
      const forwardEdit = buildForwardEdit(edit);
      if (!forwardEdit) return;
      applyEditToDocument(forwardEdit);
      setRevertedEdits((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    },
    [edits, applyEditToDocument]
  );

  const handleRevertAll = useCallback(() => {
    // Revert in reverse order so text positions remain valid
    const toRevert = revertableEdits
      .filter(({ index }) => !revertedEdits.has(index))
      .reverse();
    for (const { edit } of toRevert) {
      const reverseEdit = buildReverseEdit(edit);
      if (!reverseEdit || !documentRef || !updateDocument) continue;
      const currentDoc = documentRef.current ?? "";
      const result = applyEdits(currentDoc, [reverseEdit]);
      if ("document" in result) {
        updateDocument(result.document);
      }
    }
    setRevertedEdits(new Set(revertableEdits.map(({ index }) => index)));
  }, [revertableEdits, revertedEdits, documentRef, updateDocument]);

  const handleRestoreAll = useCallback(() => {
    // Restore in original order
    const toRestore = revertableEdits.filter(({ index }) =>
      revertedEdits.has(index)
    );
    for (const { edit } of toRestore) {
      const forwardEdit = buildForwardEdit(edit);
      if (!forwardEdit || !documentRef || !updateDocument) continue;
      const currentDoc = documentRef.current ?? "";
      const result = applyEdits(currentDoc, [forwardEdit]);
      if ("document" in result) {
        updateDocument(result.document);
      }
    }
    setRevertedEdits(new Set());
  }, [revertableEdits, revertedEdits, documentRef, updateDocument]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1">
        <CollapsibleTrigger className="flex flex-1 min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors">
          <ChevronRightIcon
            className={cn(
              "size-3.5 text-muted-foreground transition-transform shrink-0",
              open && "rotate-90"
            )}
          />
          <PencilIcon className="size-3.5 text-muted-foreground shrink-0" />
          <span
            className={cn(
              "font-medium",
              failed ? "text-red-500" : "text-muted-foreground"
            )}
          >
            {failed
              ? "Edit failed — retrying…"
              : isStreaming
                ? "Editing document…"
                : `Edited document (${editCount} ${editCount === 1 ? "edit" : "edits"})`}
          </span>
          <StatusIcon state={part.state} failed={failed} />
        </CollapsibleTrigger>
        {canRevert && revertableEdits.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-[10px] shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              allReverted ? handleRestoreAll() : handleRevertAll();
            }}
          >
            {allReverted ? (
              <>
                <Redo2Icon className="size-3 mr-1" />
                Restore All
              </>
            ) : (
              <>
                <Undo2Icon className="size-3 mr-1" />
                {someReverted ? "Revert Rest" : "Revert All"}
              </>
            )}
          </Button>
        )}
      </div>
      <CollapsibleContent>
        <div className="ml-2 mr-2 mb-2 space-y-0.5">
          {edits.map((edit, i) => (
            <EditItem
              key={i}
              edit={edit}
              isReverted={revertedEdits.has(i)}
              canRevert={canRevert && edit.type !== "rewrite"}
              onRevert={() => handleRevertEdit(i)}
              onRestore={() => handleRestoreEdit(i)}
            />
          ))}
          {edits.length === 0 && isStreaming && (
            <div className="text-xs text-muted-foreground italic px-2 py-1">
              Preparing edits…
            </div>
          )}
          {failed && typeof result === "string" && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 p-2 ml-5 text-xs text-red-400">
              {result}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
