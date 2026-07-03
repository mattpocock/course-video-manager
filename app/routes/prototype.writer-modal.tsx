"use client";

/**
 * PROTOTYPE — course-video-manager#1113 (writer-engine-extract), a ticket on the
 * CVM → AI Hero CMS auto-link wayfinder map (#1111).
 * Throwaway. Question: what should the *field-bound writer modal* look and feel
 * like, and how should the injected-context **token cost** be surfaced?
 *
 * The modal opens from a long-form Post field (here, the AI Hero **Body**). It
 * collapses the fullscreen writer's 3-pane workspace to 2 panes — chat + document
 * — and treats the field's value as the document (Apply writes back, Cancel
 * discards). Mirrors the seam from #1113: the host injects
 * `videoId / fieldId / modes / initialDocument / onApply / context / layout`.
 *
 * The live design question is the **context token counter** (Matt's ask: a raw
 * token number, bytes ÷ 4, so you can see how much the "extra stuff" costs):
 *
 *   ?variant=A — Context drawer (Sheet): per-source breakdown + big total, opened
 *                from a Context button that always shows the running total.
 *   ?variant=B — Header budget meter: an always-visible token meter in the modal
 *                header; click for the per-source Popover breakdown.
 *   ?variant=C — Inline context strip: sources as chips docked above the document,
 *                always on-screen, no drawer.
 *
 * Still a prototype: NOT wired to the real writer engine / useChat / endpoints.
 * Chat + document are hand-authored fixtures; toggling context sources only
 * recomputes the token estimate. Once a token-counter treatment wins, fold it
 * into the real modal host built in #1114 (writable-field-component), then delete
 * this file + its losing variants.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownMonacoEditor } from "@/components/markdown-monaco-editor";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  GaugeIcon,
  Layers,
  PencilIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

/* ================================================================== */
/* Token estimate — the whole point: raw tokens ≈ ceil(bytes / 4).     */
/* ================================================================== */

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;
/** Deliberately crude gauge of injected-context weight — not a real tokenizer. */
const estimateTokens = (s: string) => Math.ceil(byteLength(s) / 4);
const fmt = (n: number) => n.toLocaleString("en-US");
const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;

/** Illustrative budget bands so the number has a felt sense of "a lot". */
function tokenTone(total: number): { text: string; bar: string } {
  if (total > 12000) return { text: "text-destructive", bar: "bg-destructive" };
  if (total > 6000) return { text: "text-amber-600", bar: "bg-amber-500" };
  return { text: "text-emerald-600", bar: "bg-emerald-500" };
}

/* ================================================================== */
/* Fixtures — the injected `context: WriterContext` payload + document. */
/* ================================================================== */

type ContextSource = {
  key: string;
  label: string;
  note: string;
  text: string;
};

const TRANSCRIPT =
  `In this video we look at the satisfies operator, which shipped in TypeScript 4.9. `.repeat(
    60
  ) +
  `The problem it solves: annotating a variable widens the value to the declared type and you lose the literal information; leaving the annotation off keeps the narrow inferred type but gives you no validation. satisfies gives you both — it checks the value against the type without changing the inferred type. `.repeat(
    24
  );
const FILES =
  `readme.md\nexercise.ts\nexercise.solution.ts\nexplainer.ts\n`.repeat(6) +
  `const config = {\n  routes: { home: "/", about: "/about" },\n  theme: "dark",\n} satisfies Config;\n`.repeat(
    10
  );
const LINKS =
  `https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html\nhttps://github.com/microsoft/TypeScript/pull/46827\nhttps://www.totaltypescript.com/tips/satisfies\n`.repeat(
    4
  );
const COURSE_STRUCTURE =
  `Course: TypeScript Wizard\n  Section: Deriving Types\n    Lesson: The satisfies Operator [explainer, problem, solution]\n    Lesson: keyof and typeof\n    Lesson: Indexed Access Types\n  Section: Generics\n`.repeat(
    8
  );
const CHAPTERS =
  `00:00 The two bad options\n01:12 Annotating widens the type\n02:40 No annotation = no validation\n03:55 Enter satisfies\n05:30 A real config example\n07:10 Gotchas with unions\n`.repeat(
    6
  );
const MEMORY =
  `- Matt prefers examples before theory.\n- House style: no "simply" / "just".\n- AI Hero bodies open with the concrete problem, then mechanics, then a runnable example.\n- Keep paragraphs short; prefer code over prose where it is clearer.\n`.repeat(
    4
  );
const FULL_PATH = `typescript-wizard/deriving-types/the-satisfies-operator/explainer/readme.md`;

const CONTEXT_SOURCES: ContextSource[] = [
  {
    key: "transcript",
    label: "Transcript",
    note: "clips.text, all segments",
    text: TRANSCRIPT,
  },
  {
    key: "files",
    label: "Repo files",
    note: "readme + exercise/solution sources",
    text: FILES,
  },
  {
    key: "links",
    label: "Links",
    note: "reference URLs on the video",
    text: LINKS,
  },
  {
    key: "courseStructure",
    label: "Course structure",
    note: "sections / lessons tree",
    text: COURSE_STRUCTURE,
  },
  {
    key: "chapters",
    label: "Chapters",
    note: "meta.json chapter markers",
    text: CHAPTERS,
  },
  {
    key: "memory",
    label: "Writer memory",
    note: "standing style preferences",
    text: MEMORY,
  },
  {
    key: "fullPath",
    label: "Full path",
    note: "namespacing / source pointer",
    text: FULL_PATH,
  },
];

const INITIAL_BODY = `## The two bad options

Before \`satisfies\`, configuring a typed object forced a lose-lose choice.

Annotate it, and TypeScript **widens** every value to the declared type — you can
no longer tell that \`theme\` was \`"dark"\` specifically.

Leave the annotation off, and you keep the narrow inferred type — but nothing
checks that the object actually matches \`Config\`.

## Enter satisfies

\`satisfies\` validates the value against the type **without changing the inferred
type**:

\`\`\`ts
const config = {
  routes: { home: "/", about: "/about" },
  theme: "dark",
} satisfies Config;
// config.theme is "dark", not string — and it's still checked against Config
\`\`\`
`;

type ChatMsg = { role: "assistant" | "user" | "tool"; text: string };
const CHAT: ChatMsg[] = [
  {
    role: "assistant",
    text: "I've got the transcript, chapters and course structure loaded. Want me to draft the AI Hero body from the transcript, or start from the current field value?",
  },
  {
    role: "user",
    text: "Draft from the transcript. Lead with the problem satisfies solves, then the mechanics.",
  },
  {
    role: "tool",
    text: 'writeDocument(section: "intro") — streamed 412 chars into the document →',
  },
  {
    role: "assistant",
    text: "Done — drafted the intro and the “Enter satisfies” section into the document on the right. The widening example comes straight from chapter 3 of the transcript.",
  },
];

/** Field → mode (D6): one mode ⇒ static label, many ⇒ a real selector. */
const MODES = ["article", "skill-building", "newsletter"];

/* ================================================================== */
/* Context token model — shared across all three presentations.        */
/* ================================================================== */

function useContextModel() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CONTEXT_SOURCES.map((s) => [s.key, true]))
  );
  const toggle = useCallback(
    (key: string) => setEnabled((e) => ({ ...e, [key]: !e[key] })),
    []
  );
  const rows = useMemo(
    () =>
      CONTEXT_SOURCES.map((s) => ({
        ...s,
        on: enabled[s.key],
        tokens: estimateTokens(s.text),
        bytes: byteLength(s.text),
      })),
    [enabled]
  );
  const totalTokens = rows.reduce((a, r) => (r.on ? a + r.tokens : a), 0);
  const totalBytes = rows.reduce((a, r) => (r.on ? a + r.bytes : a), 0);
  const maxTokens = Math.max(1, ...rows.map((r) => r.tokens));
  return { rows, toggle, totalTokens, totalBytes, maxTokens };
}

type ContextModel = ReturnType<typeof useContextModel>;

/* The per-source list, reused by the drawer / popover / inline strip. */
function ContextBreakdown({ model }: { model: ContextModel }) {
  return (
    <div className="flex flex-col">
      {model.rows.map((r) => (
        <label
          key={r.key}
          className={cn(
            "flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted cursor-pointer",
            !r.on && "opacity-45"
          )}
        >
          <Checkbox
            checked={r.on}
            onCheckedChange={() => model.toggle(r.key)}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm leading-tight">{r.label}</div>
            <div className="text-xs text-muted-foreground">{r.note}</div>
            <div
              className="mt-1 h-1 rounded-full bg-primary/50"
              style={{
                width: `${Math.round((r.tokens / model.maxTokens) * 100)}%`,
              }}
            />
          </div>
          <div className="text-right font-mono text-xs">
            <div>{fmt(r.tokens)}</div>
            <div className="text-[10px] text-muted-foreground">
              {fmtBytes(r.bytes)}
            </div>
          </div>
        </label>
      ))}
    </div>
  );
}

function ContextTotalCard({ model }: { model: ContextModel }) {
  const tone = tokenTone(model.totalTokens);
  return (
    <div className="flex items-baseline justify-between rounded-lg border bg-muted/40 px-4 py-3">
      <div>
        <div className={cn("font-mono text-2xl font-semibold", tone.text)}>
          {fmt(model.totalTokens)}
        </div>
        <div className="text-xs text-muted-foreground">
          tokens injected (bytes ÷ 4)
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm">{fmtBytes(model.totalBytes)}</div>
        <div className="text-xs text-muted-foreground">raw bytes</div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* The field-bound writer modal.                                       */
/* ================================================================== */

function WriterModal({
  variant,
  open,
  onOpenChange,
  initialValue,
  onApply,
}: {
  variant: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue: string;
  onApply: (value: string) => void;
}) {
  const [doc, setDoc] = useState(initialValue);
  const [mode, setMode] = useState(MODES[0]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const ctx = useContextModel();
  const tone = tokenTone(ctx.totalTokens);
  const docTokens = estimateTokens(doc);

  // Reseed the working copy whenever the field re-opens (D1/D5: field value IS the doc).
  useEffect(() => {
    if (open) setDoc(initialValue);
  }, [open, initialValue]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[82vh] max-h-[780px] w-[94vw] max-w-[1120px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1120px]"
      >
        {/* Header */}
        <div className="flex h-13 flex-none items-center gap-3 border-b bg-muted/40 px-4 py-2">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Badge variant="secondary" className="font-mono text-[11px]">
              writer
            </Badge>
            AI Hero Body
          </DialogTitle>

          {/* D6: one mode ⇒ static label; many ⇒ selector. */}
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger size="sm" className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m} value={m} className="font-mono text-xs">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          {/* --- Variant A: Context button carrying the running total --- */}
          {variant === "A" && (
            <Button
              variant={drawerOpen ? "secondary" : "outline"}
              size="sm"
              onClick={() => setDrawerOpen((o) => !o)}
            >
              <Layers className="size-4" />
              Context
              <Badge
                variant="outline"
                className={cn("ml-1 font-mono", tone.text)}
              >
                ~{fmt(ctx.totalTokens)} tok
              </Badge>
            </Button>
          )}

          {/* --- Variant B: always-on header budget meter (+ popover) --- */}
          {variant === "B" && <HeaderMeter model={ctx} />}

          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>

        {/* Body: 2 panes — chat + document */}
        <div className="relative flex min-h-0 flex-1">
          {/* Chat */}
          <div className="flex w-2/5 flex-col border-r">
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {CHAT.map((m, i) => (
                <ChatBubble key={i} msg={m} />
              ))}
            </div>
            <div className="flex flex-none items-end gap-2 border-t p-3">
              <Textarea
                rows={1}
                placeholder="Ask the writer to revise the document…"
                className="max-h-28 min-h-[42px] resize-none"
              />
              <Button size="icon" className="flex-none">
                <SendIcon className="size-4" />
              </Button>
            </div>
          </div>

          {/* Document */}
          <div className="flex flex-1 flex-col">
            {/* Variant C: inline context strip docked above the document */}
            {variant === "C" && <InlineContextStrip model={ctx} />}

            <div className="flex h-8 flex-none items-center gap-2 border-b px-3 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              <FileText className="size-3.5" />
              document · working copy (unsaved)
              <span className="ml-auto font-mono">{fmt(docTokens)} tok</span>
            </div>
            <div className="min-h-0 flex-1">
              <MarkdownMonacoEditor
                value={doc}
                onChange={setDoc}
                fallback={
                  <div className="p-4 text-sm text-muted-foreground">
                    Loading editor…
                  </div>
                }
              />
            </div>
          </div>

          {/* Variant A: Context drawer — an in-modal sliding panel (not a
              Sheet, so it sits alongside the document instead of dimming it). */}
          {variant === "A" && (
            <aside
              className={cn(
                "absolute inset-y-0 right-0 z-10 flex w-[380px] flex-col border-l bg-muted/40 shadow-xl transition-transform duration-200",
                drawerOpen
                  ? "translate-x-0"
                  : "pointer-events-none translate-x-full"
              )}
            >
              <div className="flex-none border-b px-4 py-3">
                <div className="text-sm font-semibold">Injected context</div>
                <p className="text-xs text-muted-foreground">
                  Everything the host passes into the agent — the “extra stuff”
                  behind the modal.
                </p>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
                <ContextTotalCard model={ctx} />
                <ContextBreakdown model={ctx} />
                <p className="text-xs text-muted-foreground">
                  Estimate:{" "}
                  <code className="font-mono">tokens ≈ ⌈bytes / 4⌉</code>{" "}
                  (UTF-8). Toggle a source to see its cost. This is the{" "}
                  <code className="font-mono">context: WriterContext</code>{" "}
                  payload.
                </p>
              </div>
            </aside>
          )}
        </div>

        {/* Footer */}
        <div className="flex h-14 flex-none items-center justify-end gap-3 border-t bg-muted/40 px-4">
          <span className="mr-auto text-xs text-muted-foreground">
            Working copy — <b>Apply</b> writes back to the field · <b>Cancel</b>{" "}
            discards ·{" "}
            <span className={cn("font-mono", tone.text)}>
              ~{fmt(ctx.totalTokens)}
            </span>{" "}
            context tok
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onApply(doc);
              onOpenChange(false);
            }}
          >
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChatBubble({ msg }: { msg: ChatMsg }) {
  if (msg.role === "tool") {
    return (
      <div className="rounded-md border border-dashed px-3 py-2 font-mono text-xs text-muted-foreground">
        ↳ tool: {msg.text}
      </div>
    );
  }
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {isUser ? "you" : "writer"}
      </div>
      <div
        className={cn(
          "max-w-[92%] rounded-lg px-3 py-2 text-sm",
          isUser ? "bg-accent" : "border bg-muted"
        )}
      >
        {msg.text}
      </div>
    </div>
  );
}

/* Variant B — always-visible header meter with a popover breakdown. */
function HeaderMeter({ model }: { model: ContextModel }) {
  const tone = tokenTone(model.totalTokens);
  const pct = Math.min(100, Math.round((model.totalTokens / 16000) * 100));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 rounded-md border px-3 py-1.5 hover:bg-muted">
          <GaugeIcon className={cn("size-4", tone.text)} />
          <span className={cn("font-mono text-sm", tone.text)}>
            {fmt(model.totalTokens)}
          </span>
          <span className="text-xs text-muted-foreground">ctx tok</span>
          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
            <span
              className={cn("block h-full", tone.bar)}
              style={{ width: `${pct}%` }}
            />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px]">
        <div className="mb-2 text-sm font-medium">Injected context</div>
        <ContextTotalCard model={model} />
        <div className="mt-2">
          <ContextBreakdown model={model} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          <code className="font-mono">tokens ≈ ⌈bytes / 4⌉</code> (UTF-8)
        </p>
      </PopoverContent>
    </Popover>
  );
}

/* Variant C — inline context strip docked above the document. */
function InlineContextStrip({ model }: { model: ContextModel }) {
  const tone = tokenTone(model.totalTokens);
  return (
    <div className="flex flex-none flex-wrap items-center gap-1.5 border-b bg-muted/30 px-3 py-2">
      <span className="mr-1 flex items-center gap-1.5 text-xs font-medium">
        <Layers className="size-3.5" /> Context
        <span className={cn("font-mono", tone.text)}>
          ~{fmt(model.totalTokens)} tok
        </span>
      </span>
      {model.rows.map((r) => (
        <button
          key={r.key}
          onClick={() => model.toggle(r.key)}
          className={cn(
            "rounded-full border px-2 py-0.5 font-mono text-[11px] transition-colors",
            r.on
              ? "bg-background hover:bg-muted"
              : "bg-transparent text-muted-foreground line-through opacity-60"
          )}
          title={`${r.note} · ${fmtBytes(r.bytes)}`}
        >
          {r.label} {fmt(r.tokens)}
        </button>
      ))}
    </div>
  );
}

/* ================================================================== */
/* Host page — a faithful copy of the AI Hero form's field layout, so  */
/* the modal is judged against the real page density.                  */
/* ================================================================== */

const VARIANTS = ["A", "B", "C"] as const;
const VARIANT_NAMES: Record<string, string> = {
  A: "Context drawer",
  B: "Header meter",
  C: "Inline strip",
};

export default function PrototypeWriterModal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const variant = (searchParams.get("variant") ?? "A").toUpperCase();

  const [body, setBody] = useState(INITIAL_BODY);
  const [modalOpen, setModalOpen] = useState(false);

  const setVariant = useCallback(
    (v: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("variant", v);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  // ← / → cycle variants (ignore when typing / in the editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el as HTMLElement)?.isContentEditable ||
        el?.closest(".monaco-editor")
      )
        return;
      const i = VARIANTS.indexOf(variant as (typeof VARIANTS)[number]);
      const j =
        i < 0
          ? 0
          : (i + (e.key === "ArrowRight" ? 1 : VARIANTS.length - 1)) %
            VARIANTS.length;
      setVariant(VARIANTS[j]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, setVariant]);

  return (
    <div className="h-screen overflow-y-auto bg-background">
      {/* Fake app chrome so the field sits in a realistic page. */}
      <div className="flex h-12 items-center gap-3 border-b px-4">
        <span className="text-sm font-medium text-muted-foreground">
          course-video-manager
        </span>
        <span className="text-sm text-muted-foreground">
          TypeScript Wizard / Deriving Types /{" "}
          <b className="text-foreground">The satisfies Operator</b>
        </span>
        <div className="ml-auto flex gap-1 text-sm">
          <span className="rounded px-3 py-1.5 text-muted-foreground">
            Video
          </span>
          <span className="rounded px-3 py-1.5 text-muted-foreground">
            Write
          </span>
          <span className="rounded bg-muted px-3 py-1.5 text-foreground">
            Post
          </span>
        </div>
      </div>
      <div className="flex h-10 items-center gap-1 border-b px-4 text-sm">
        <span className="px-3 py-1 text-muted-foreground">YouTube</span>
        <span className="px-3 py-1 text-muted-foreground">X / LinkedIn</span>
        <span className="border-b-2 border-primary px-3 py-1 text-foreground">
          AI Hero
        </span>
        <span className="px-3 py-1 text-muted-foreground">
          Skills Changelog
        </span>
        <span className="px-3 py-1 text-muted-foreground">Newsletter</span>
      </div>

      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            defaultValue="The satisfies Operator: type-safe config without widening"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="slug">Slug</Label>
          <Input
            id="slug"
            className="font-mono text-sm"
            defaultValue="the-satisfies-operator"
          />
        </div>

        {/* The click-to-edit long-form field (the point). */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            Body (Markdown)
            <span className="text-xs font-normal text-primary">
              · click to edit in the writer
            </span>
          </Label>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="group relative block min-h-[220px] w-full rounded-md border bg-background p-4 text-left font-mono text-sm hover:border-primary/40 hover:bg-muted/30"
          >
            <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded border bg-background px-2 py-1 text-xs font-sans text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
              <PencilIcon className="size-3.5" /> Edit in writer
            </span>
            <span className="whitespace-pre-wrap text-foreground">{body}</span>
          </button>
          <p className="text-xs text-muted-foreground">
            This becomes <code className="font-mono">video.body</code> and
            exports into <code className="font-mono">course.json</code>. Its
            value <b>is</b> the writer document.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="seo">SEO Description</Label>
          <Textarea
            id="seo"
            defaultValue="Learn how TypeScript's satisfies operator validates a value against a type while preserving its narrow inferred literal type."
          />
        </div>
      </div>

      <WriterModal
        variant={variant}
        open={modalOpen}
        onOpenChange={setModalOpen}
        initialValue={body}
        onApply={setBody}
      />

      {/* Floating variant switcher (prototype only). */}
      <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur">
        <SparklesIcon className="mx-1 size-3.5 text-muted-foreground" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => {
            const i = Math.max(
              0,
              VARIANTS.indexOf(variant as (typeof VARIANTS)[number])
            );
            setVariant(VARIANTS[(i + VARIANTS.length - 1) % VARIANTS.length]!);
          }}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-[150px] text-center text-xs font-medium">
          {variant} — {VARIANT_NAMES[variant] ?? "?"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => {
            const i = Math.max(
              0,
              VARIANTS.indexOf(variant as (typeof VARIANTS)[number])
            );
            setVariant(VARIANTS[(i + 1) % VARIANTS.length]!);
          }}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
