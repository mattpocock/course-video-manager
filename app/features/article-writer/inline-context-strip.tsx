import { cn } from "@/lib/utils";
import { Layers, CheckIcon, MinusIcon, ChevronRight } from "lucide-react";

// ─── Token utilities ────────────────────────────────────────────────────────

/** Rough token estimate: UTF-8 byte length / 4. */
export function estimateTokens(s: string): number {
  return Math.ceil(new TextEncoder().encode(s).length / 4);
}

/** Format a token count for display (e.g. 842 -> "842", 4100 -> "4.1K"). */
export function fmtTok(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}K`;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type SourceView = {
  key: string;
  label: string;
  note: string;
  items: Array<{
    id: string;
    label: string;
    text: string;
    on: boolean;
    tokens: number;
  }>;
  onCount: number;
  check: boolean | "indeterminate";
  /** Atomic sources toggle as a whole (no per-item toggle). */
  atomic: boolean;
  /** Sum of tokens for enabled items. */
  tokens: number;
};

// ─── CheckGlyph ─────────────────────────────────────────────────────────────

export function CheckGlyph({ state }: { state: boolean | "indeterminate" }) {
  if (state === "indeterminate") {
    return (
      <span className="flex size-3.5 items-center justify-center rounded-sm border bg-primary text-primary-foreground">
        <MinusIcon className="size-2.5" />
      </span>
    );
  }
  if (state === true) {
    return (
      <span className="flex size-3.5 items-center justify-center rounded-sm border bg-primary text-primary-foreground">
        <CheckIcon className="size-2.5" />
      </span>
    );
  }
  return (
    <span className="flex size-3.5 items-center justify-center rounded-sm border bg-muted" />
  );
}

// ─── InlineContextStrip ─────────────────────────────────────────────────────

interface InlineContextStripProps {
  sources: SourceView[];
  totalTokens: number;
  onToggleSource: (sourceKey: string) => void;
  onToggleItem: (itemId: string) => void;
  onOpenPanel: () => void;
}

export function InlineContextStrip({
  sources,
  totalTokens,
  onToggleSource,
  onOpenPanel,
}: InlineContextStripProps) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-1.5 border-b bg-muted/30 px-3 py-2">
      <button
        onClick={onOpenPanel}
        className="mr-1 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        title="Open the full context panel"
      >
        <Layers className="size-3.5" />
        <span>Context</span>
        <span className="font-mono tabular-nums normal-case">
          {fmtTok(totalTokens)}
        </span>
        <ChevronRight className="size-3.5" />
      </button>

      {sources.map((s) => (
        <button
          key={s.key}
          onClick={() => onToggleSource(s.key)}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
            s.check === false
              ? "bg-transparent text-muted-foreground opacity-70"
              : "bg-background hover:bg-muted"
          )}
          title={`${s.note} · ${s.onCount}/${s.items.length} on`}
        >
          <CheckGlyph state={s.check} />
          <span>{s.label}</span>
          <span className="w-9 text-right font-mono tabular-nums text-muted-foreground">
            {fmtTok(s.tokens)}
          </span>
        </button>
      ))}
    </div>
  );
}
