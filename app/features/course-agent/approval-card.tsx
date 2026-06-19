"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProposedOps } from "./types";
import type { Op, AddOp, ReorderOp } from "@/services/vfs/derive-diff-types";
import {
  ArchiveRestore,
  ArrowRight,
  Check,
  Copy,
  FilePlus2,
  FileText,
  ListOrdered,
  Pencil,
  Trash2,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";

type OpStyle = { Icon: LucideIcon; verb: string; tone: string };

const NEUTRAL = "text-muted-foreground";

function opStyle(op: Op): OpStyle {
  switch (op.type) {
    case "edit":
      return { Icon: Pencil, verb: "Edit", tone: NEUTRAL };
    case "delete":
      return { Icon: Trash2, verb: "Archive", tone: "text-red-600" };
    case "reorder":
      return { Icon: ListOrdered, verb: "Reorder", tone: NEUTRAL };
    case "add":
      if (op.sub === "unarchive")
        return { Icon: ArchiveRestore, verb: "Move in", tone: NEUTRAL };
      if (op.sub === "copy") return { Icon: Copy, verb: "Copy", tone: NEUTRAL };
      return { Icon: FilePlus2, verb: "Add", tone: NEUTRAL };
  }
}

function opTarget(op: Op): string {
  if (op.type === "edit") return `${op.target} · ${op.field}`;
  return op.target;
}

function BeforeAfter({ before, after }: { before: string; after: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground line-through decoration-muted-foreground/40">
        {before}
      </span>
      <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono font-medium text-foreground">
        {after}
      </span>
    </div>
  );
}

function SpatialOp({ op }: { op: Op }) {
  switch (op.type) {
    case "edit":
      return (
        <div className="rounded-md border border-border bg-muted/30 p-2">
          <BeforeAfter before={String(op.before)} after={String(op.after)} />
        </div>
      );
    case "delete":
      return (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50/60 p-2 dark:border-red-900 dark:bg-red-950/30">
          <span className="text-xs text-red-700 line-through decoration-red-400 dark:text-red-400">
            {op.target}
          </span>
          <span className="ml-auto rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/50 dark:text-red-400">
            archived
          </span>
        </div>
      );
    case "add":
      return <AddOpDetail op={op} />;
    case "reorder":
      return <ReorderOpDetail op={op} />;
  }
}

function AddOpDetail({ op }: { op: AddOp }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2">
      <div className="flex items-center gap-1.5 text-xs">
        {op.sub === "unarchive" && op.detail.sourceParent && (
          <>
            <span className="text-muted-foreground line-through">
              {op.detail.sourceParent}
            </span>
            <ArrowRight className="size-3 text-muted-foreground" />
          </>
        )}
        <span className="font-medium text-foreground">{op.target}</span>
      </div>
      {op.sub === "copy" && op.detail.footageMatch && (
        <div className="mt-1 flex flex-wrap gap-1">
          <span className="rounded bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            footage: {op.detail.footageMatch.videoFilename}
          </span>
          <span className="rounded bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            in / out: {op.detail.footageMatch.sourceStartTime} →{" "}
            {op.detail.footageMatch.sourceEndTime}
          </span>
        </div>
      )}
      {op.sub === "create" && op.detail.values && (
        <div className="mt-1 flex flex-wrap gap-1">
          {Object.entries(op.detail.values).map(([k, v]) => (
            <span
              key={k}
              className="rounded bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {k}: {String(v)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ReorderOpDetail({ op }: { op: ReorderOp }) {
  const beforeItems = [...op.order]
    .filter((o) => o.fromIndex >= 0)
    .sort((a, b) => a.fromIndex - b.fromIndex);

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
      <ol className="space-y-0.5">
        {beforeItems.map((o) => (
          <li
            key={`b${o.fromIndex}`}
            className="truncate text-[11px] text-muted-foreground"
          >
            {o.fromIndex + 1}. {o.label}
          </li>
        ))}
      </ol>
      <ArrowRight className="size-4 text-muted-foreground" />
      <ol className="space-y-0.5">
        {op.order.map((o) => {
          const moved = o.fromIndex !== o.toIndex;
          return (
            <li
              key={`a${o.toIndex}`}
              className={cn(
                "truncate text-[11px]",
                moved ? "font-medium text-foreground" : "text-muted-foreground"
              )}
            >
              {o.toIndex + 1}. {o.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CardOpsBody({ proposed }: { proposed: ProposedOps }) {
  return (
    <>
      {proposed.note && (
        <div className="flex items-start gap-1.5 border-b border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <ArchiveRestore className="mt-px size-3.5 shrink-0" />
          <span>{proposed.note}</span>
        </div>
      )}
      <div className="space-y-3 p-3">
        {proposed.ops.map((op, i) => {
          const s = opStyle(op);
          return (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <s.Icon className={cn("size-3.5", s.tone)} />
                <span className={cn("text-[11px] font-semibold", s.tone)}>
                  {s.verb}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {opTarget(op)}
                </span>
              </div>
              <SpatialOp op={op} />
            </div>
          );
        })}
      </div>
    </>
  );
}

export function ApprovalCard({
  proposed,
  onApprove,
  onReject,
  disabled,
}: {
  proposed: ProposedOps;
  onApprove: () => void;
  onReject: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-start gap-2 border-b border-border bg-muted/40 px-3 py-2.5">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            Proposed edit
            <span className="rounded bg-muted px-1 py-px font-mono text-[10px] font-medium text-muted-foreground">
              {proposed.tool}
            </span>
          </div>
          <code className="block truncate text-[11px] text-muted-foreground">
            {proposed.path}
          </code>
        </div>
      </div>

      <CardOpsBody proposed={proposed} />

      <div className="space-y-2 border-t border-border p-3">
        <Button className="w-full" onClick={onApprove} disabled={disabled}>
          <Check className="mr-1 size-4" /> Approve all {proposed.ops.length}{" "}
          change{proposed.ops.length === 1 ? "" : "s"}
        </Button>
        <button
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
          onClick={onReject}
          disabled={disabled}
        >
          Reject this edit
        </button>
      </div>
    </div>
  );
}

export function RejectedCard({ proposed }: { proposed: ProposedOps }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm opacity-75">
      <div className="flex items-start gap-2 border-b border-border bg-muted/40 px-3 py-2.5">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            Rejected edit
            <span className="rounded bg-red-100 px-1 py-px font-mono text-[10px] font-medium text-red-700 dark:bg-red-900/50 dark:text-red-400">
              rejected
            </span>
          </div>
          <code className="block truncate text-[11px] text-muted-foreground">
            {proposed.path}
          </code>
        </div>
      </div>

      <CardOpsBody proposed={proposed} />
    </div>
  );
}

export function InvalidEditLine({ message }: { message: string }) {
  const newlineIdx = message.indexOf("\n");
  const hasDetails = newlineIdx !== -1;
  const summary = hasDetails ? message.slice(0, newlineIdx) : message;
  const details = hasDetails ? message.slice(newlineIdx + 1) : null;

  return (
    <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        <span>
          Agent proposed an invalid edit — retrying.{" "}
          <span className="italic">{summary}</span>
        </span>
        {details && (
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground/80">
            {details}
          </pre>
        )}
      </div>
    </div>
  );
}
