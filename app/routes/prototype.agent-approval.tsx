"use client";

/**
 * PROTOTYPE — decision-map ticket #6 (docs/decision-maps/course-agent-editing.md).
 * Throwaway. Question (RESOLVED): what should the per-approval *breakdown UI* look like?
 *
 * One file-write ⇒ one approval (R2). The approval bundles a derived op-list
 * (Add / Delete / EditField / Reorder, plus the guarded Add sub-cases Unarchive
 * and Clip-copy from #4). Three variants were prototyped; **variant C — spatial
 * before/after — won**. The losing branches (flat list, grouped-by-kind) and the
 * variant switcher have been deleted. Palette is monochrome — icons carry the
 * op distinction; red is reserved for delete/archive (the one destructive op).
 *
 *   ?scenario=0..N — flip the underlying diff (timeline reorder+delete, lesson
 *                    multi-field edit, cross-section move, ghost+copy)
 *
 * Still a prototype: NOT wired to a live agent (the edit/write tools #5/#7 don't
 * exist yet), so the op-lists are hand-authored fixtures and Accept/Reject just
 * `console.log`. Fold the card into course-agent-panel.tsx at #7/#2; then delete.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
} from "lucide-react";
import { useCallback } from "react";
import { useSearchParams } from "react-router";

/* ================================================================== */
/* Domain — the derived op-list (#4). This is the contract #6 renders. */
/* ================================================================== */

type EntityKind = "section" | "lesson" | "video" | "beat" | "chapter" | "clip";

type Op =
  // EditField — one op per changed scalar field (R4-checked upstream)
  | {
      kind: "edit";
      entity: EntityKind;
      /** human label of the entity being edited, e.g. "lesson “Narrowing”" */
      target: string;
      field: string;
      before: string;
      after: string;
    }
  // Delete — soft-archive
  | { kind: "delete"; entity: EntityKind; target: string }
  // Add — plain create (ghost), or the two guarded sub-cases
  | {
      kind: "add";
      entity: EntityKind;
      target: string;
      sub: "create" | "unarchive" | "copy";
      /** for create: the seed fields; for copy: the footage triple echoed */
      detail?: { label: string; value: string }[];
      /** for unarchive: where it came from */
      from?: string;
    }
  // Reorder — final order of a sibling set; we carry the moved lines for display
  | {
      kind: "reorder";
      entity: EntityKind;
      /** the container whose children reordered, e.g. "timeline of video 03" */
      target: string;
      /** full final order, with each item's previous index (null = newly added) */
      order: { label: string; fromIndex: number | null; toIndex: number }[];
    };

type ApprovalFixture = {
  id: string;
  /** the single file the write/edit targeted (R2: one file ⇒ one approval) */
  file: string;
  /** which tool produced it, for the card chrome */
  tool: "write" | "edit";
  /** optional two-step-move banner (R8) */
  note?: string;
  ops: Op[];
};

/* ================================================================== */
/* Fixtures — realistic diffs to judge the card against.              */
/* ================================================================== */

const SCENARIOS: ApprovalFixture[] = [
  // The named case: timeline reorder + chapter delete in ONE write.
  {
    id: "timeline",
    file: "videos/03-pattern-matching/timeline/_members.json",
    tool: "edit",
    ops: [
      {
        kind: "reorder",
        entity: "clip",
        target: "timeline of “03 Pattern Matching”",
        order: [
          { label: "“So the first thing we do…”", fromIndex: 0, toIndex: 0 },
          { label: "“Now watch what happens…”", fromIndex: 3, toIndex: 1 },
          { label: "“This is the key insight…”", fromIndex: 1, toIndex: 2 },
          { label: "“Let me show you the error…”", fromIndex: 2, toIndex: 3 },
        ],
      },
      { kind: "delete", entity: "chapter", target: "chapter “Setup”" },
    ],
  },

  // Pure multi-field lesson edit (write to lesson.json).
  {
    id: "lesson-fields",
    file: "sections/02-narrowing/lessons/04-discriminated-unions/lesson.json",
    tool: "write",
    ops: [
      {
        kind: "edit",
        entity: "lesson",
        target: "lesson “Discriminated Unions”",
        field: "title",
        before: "Discriminated Unions",
        after: "Discriminated Unions in Practice",
      },
      {
        kind: "edit",
        entity: "lesson",
        target: "lesson “Discriminated Unions”",
        field: "slug",
        before: "discriminated-unions",
        after: "discriminated-unions-in-practice",
      },
      {
        kind: "edit",
        entity: "lesson",
        target: "lesson “Discriminated Unions”",
        field: "priority",
        before: "normal",
        after: "high",
      },
      {
        kind: "edit",
        entity: "lesson",
        target: "lesson “Discriminated Unions”",
        field: "authoringStatus",
        before: "draft",
        after: "ready",
      },
    ],
  },

  // Cross-section lesson move — approval 2 of 2 (R8 Unarchive+reparent),
  // also nudges the destination order.
  {
    id: "move",
    file: "sections/03-conditional-types/lessons/_members.json",
    tool: "edit",
    note: "Step 2 of 2 — completes moving “infer keyword” out of “Narrowing”. Rejecting leaves the lesson archived.",
    ops: [
      {
        kind: "add",
        entity: "lesson",
        target: "lesson “The infer keyword”",
        sub: "unarchive",
        from: "section “Narrowing”",
      },
      {
        kind: "reorder",
        entity: "lesson",
        target: "lessons of “Conditional Types”",
        order: [
          { label: "Mapped Types", fromIndex: 0, toIndex: 0 },
          { label: "The infer keyword", fromIndex: null, toIndex: 1 },
          { label: "Recursive Conditionals", fromIndex: 1, toIndex: 2 },
        ],
      },
    ],
  },

  // Ghost-lesson add + clip copy — the two structural Add flavours together.
  {
    id: "add-copy",
    file: "sections/01-intro/lessons/_members.json",
    tool: "edit",
    ops: [
      {
        kind: "add",
        entity: "lesson",
        target: "lesson “Why TypeScript?”",
        sub: "create",
        detail: [
          { label: "slug", value: "why-typescript" },
          { label: "authoringStatus", value: "ghost" },
        ],
      },
      {
        kind: "add",
        entity: "clip",
        target: "clip from “intro-take-2.mp4”",
        sub: "copy",
        detail: [
          { label: "footage", value: "intro-take-2.mp4" },
          { label: "in / out", value: "00:12.40 → 00:48.10" },
        ],
      },
    ],
  },
];

/* ================================================================== */
/* Op presentation — icons carry the distinction; red only for delete. */
/* ================================================================== */

type OpStyle = { Icon: typeof Pencil; verb: string; tone: string };

// Monochrome by default; delete is the one coloured (destructive) op.
const NEUTRAL = "text-muted-foreground";

function opStyle(op: Op): OpStyle {
  switch (op.kind) {
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

/* small reusable diff atom: before → after */
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

/* ================================================================== */
/* The approval card — variant C, spatial before/after.               */
/* ================================================================== */

function ApprovalCard({ fixture }: { fixture: ApprovalFixture }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* header: one card = one approval = one file (R2) */}
      <div className="flex items-start gap-2 border-b border-border bg-muted/40 px-3 py-2.5">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            Proposed edit
            <span className="rounded bg-muted px-1 py-px font-mono text-[10px] font-medium text-muted-foreground">
              {fixture.tool}
            </span>
          </div>
          <code className="block truncate text-[11px] text-muted-foreground">
            {fixture.file}
          </code>
        </div>
      </div>

      {/* R8 two-step-move banner */}
      {fixture.note && (
        <div className="flex items-start gap-1.5 border-b border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <ArchiveRestore className="mt-px size-3.5 shrink-0" />
          <span>{fixture.note}</span>
        </div>
      )}

      <div className="space-y-3 p-3">
        {fixture.ops.map((op, i) => {
          const s = opStyle(op);
          return (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <s.Icon className={cn("size-3.5", s.tone)} />
                <span className={cn("text-[11px] font-semibold", s.tone)}>
                  {s.verb}
                </span>
                <span className="truncate text-[11px] text-muted-foreground">
                  {op.kind === "edit"
                    ? `${op.target} · ${op.field}`
                    : op.target}
                </span>
              </div>
              <SpatialOp op={op} />
            </div>
          );
        })}
      </div>

      <div className="space-y-2 border-t border-border p-3">
        <Button
          className="w-full"
          onClick={() => console.log("APPROVE", fixture.id)}
        >
          <Check className="mr-1 size-4" /> Approve all {fixture.ops.length}{" "}
          change{fixture.ops.length === 1 ? "" : "s"}
        </Button>
        <button
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => console.log("REJECT", fixture.id)}
        >
          Reject this edit
        </button>
      </div>
    </div>
  );
}

/* The spatial heart: render the change as a shape, not a sentence. */
function SpatialOp({ op }: { op: Op }) {
  switch (op.kind) {
    case "edit":
      return (
        <div className="rounded-md border border-border bg-muted/30 p-2">
          <BeforeAfter before={op.before} after={op.after} />
        </div>
      );
    case "delete":
      return (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50/60 p-2">
          <span className="text-xs text-red-700 line-through decoration-red-400">
            {op.target}
          </span>
          <span className="ml-auto rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
            archived
          </span>
        </div>
      );
    case "add":
      return (
        <div className="rounded-md border border-border bg-muted/30 p-2">
          <div className="flex items-center gap-1.5 text-xs">
            {op.sub === "unarchive" && op.from && (
              <>
                <span className="text-muted-foreground line-through">
                  {op.from}
                </span>
                <ArrowRight className="size-3 text-muted-foreground" />
              </>
            )}
            <span className="font-medium text-foreground">{op.target}</span>
          </div>
          {op.detail && (
            <div className="mt-1 flex flex-wrap gap-1">
              {op.detail.map((d) => (
                <span
                  key={d.label}
                  className="rounded bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {d.label}: {d.value}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    case "reorder":
      // two columns: before order vs after order
      return (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-md border border-border bg-muted/30 p-2">
          <ol className="space-y-0.5">
            {[...op.order]
              .filter((o) => o.fromIndex !== null)
              .sort((a, b) => a.fromIndex! - b.fromIndex!)
              .map((o) => (
                <li
                  key={`b${o.fromIndex}`}
                  className="truncate text-[11px] text-muted-foreground"
                >
                  {o.fromIndex! + 1}. {o.label}
                </li>
              ))}
          </ol>
          <ArrowRight className="size-4 text-muted-foreground" />
          <ol className="space-y-0.5">
            {op.order.map((o) => {
              const moved = o.fromIndex !== null && o.fromIndex !== o.toIndex;
              const added = o.fromIndex === null;
              return (
                <li
                  key={`a${o.toIndex}`}
                  className={cn(
                    "truncate text-[11px]",
                    moved || added
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
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
}

/* ================================================================== */
/* Route shell — faux sidebar at real density + scenario flipper      */
/* ================================================================== */

export default function AgentApprovalPrototype() {
  const [params, setParams] = useSearchParams();
  const scenarioIdx = Math.min(
    Math.max(0, Number(params.get("scenario") ?? 0)),
    SCENARIOS.length - 1
  );
  const fixture = SCENARIOS[scenarioIdx]!;

  const setScenario = useCallback(
    (i: number) =>
      setParams(
        (prev) => {
          prev.set("scenario", String(i));
          return prev;
        },
        { replace: true, preventScrollReset: true }
      ),
    [setParams]
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* faux course content, dimmed, just to give the sidebar a real edge */}
      <div className="flex-1 p-8 text-muted-foreground/40">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="h-8 w-2/3 rounded bg-muted" />
          <div className="h-4 w-full rounded bg-muted" />
          <div className="h-4 w-5/6 rounded bg-muted" />
          <div className="grid grid-cols-2 gap-3 pt-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-muted" />
            ))}
          </div>
        </div>
      </div>

      {/* the agent sidebar at real width */}
      <aside className="flex h-screen w-[400px] shrink-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border px-3 py-2.5 text-sm font-semibold">
          Course Agent
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
          {/* faux conversation context above the approval card */}
          <div className="ml-auto w-fit max-w-[80%] rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
            Move the error clip earlier and drop the Setup chapter.
          </div>
          <p className="text-sm text-foreground">
            I&apos;ve prepared the change. Review the breakdown below and
            approve or reject it.
          </p>
          <ApprovalCard fixture={fixture} />
        </div>
      </aside>

      <ScenarioFlipper current={scenarioIdx} onPick={setScenario} />
    </div>
  );
}

function ScenarioFlipper({
  current,
  onPick,
}: {
  current: number;
  onPick: (i: number) => void;
}) {
  if (import.meta.env.PROD) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-1.5 py-1 text-zinc-100 shadow-2xl ring-1 ring-white/10">
      <span className="px-1.5 text-[10px] uppercase tracking-wide text-zinc-400">
        scenario
      </span>
      {SCENARIOS.map((s, i) => (
        <button
          key={s.id}
          onClick={() => onPick(i)}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
            i === current
              ? "bg-white text-zinc-900"
              : "text-zinc-400 hover:text-zinc-100"
          )}
        >
          {s.id}
        </button>
      ))}
    </div>
  );
}
