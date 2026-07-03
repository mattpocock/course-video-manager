"use client";

/**
 * PROTOTYPE — course-video-manager#1113 (writer-engine-extract), a ticket on the
 * CVM → AI Hero CMS auto-link wayfinder map (#1111).
 * Throwaway. Question: what should the *field-bound writer modal* look and feel
 * like, and how should the injected-context **token cost** be surfaced?
 *
 * The modal opens from a long-form Post field (here, the AI Hero **Body**). It
 * collapses the fullscreen writer's 3-pane workspace to 2 panes — chat + document
 * — and treats the field's value as the document. Mirrors the seam from #1113:
 * the host injects `videoId / fieldId / modes / initialDocument / onApply /
 * context / layout`.
 *
 * DESIGN LOCKED (Matt's call, 2026-07-03): the winning token-counter treatment is
 * the **inline context strip** — sources shown as chips docked above the document,
 * always on-screen. Refinements baked in here:
 *
 *   • Each chip is a real toggle with a checkbox. A source made of parts
 *     (transcript segments, chapters, repo files, links) can be **partially on**
 *     → the checkbox shows an indeterminate state.
 *   • The "Context" button opens a full-options panel where individual parts
 *     (each chapter, each file…) can be toggled.
 *   • Token counts read as `4.1K`.
 *   • The document pane matches the real writer: Edit ⇄ Preview and a lint
 *     "Fix (N)" button (mirrors `document-panel.tsx`).
 *   • Cancel reverts the conversation history to what it was before the modal
 *     opened; closing with unsaved changes asks for confirmation first.
 *   • Footer is just Cancel / Apply — no explanation blurb, no token count.
 *
 * Still a prototype: NOT wired to the real writer engine / useChat / endpoints.
 * Chat + document + context sources are hand-authored fixtures. Once this shape is
 * folded into the real modal host built in #1114 (writable-field-component),
 * delete this file.
 */

import { AIResponse } from "components/ui/kibo-ui/ai/response";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  AlertTriangleIcon,
  CheckIcon,
  EyeIcon,
  FileText,
  Layers,
  MinusIcon,
  PencilIcon,
  SendIcon,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

/* ================================================================== */
/* Token estimate — the whole point: raw tokens ≈ ceil(bytes / 4).     */
/* ================================================================== */

const encoder = new TextEncoder();
const byteLength = (s: string) => encoder.encode(s).length;
/** Deliberately crude gauge of injected-context weight — not a real tokenizer. */
const estimateTokens = (s: string) => Math.ceil(byteLength(s) / 4);

/** Compact token label, Matt's format: 812 → "812", 4123 → "4.1K". */
const fmtTok = (n: number) =>
  n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}K`;

/** Illustrative budget bands so the total has a felt sense of "a lot". */
function tokenTone(total: number): string {
  if (total > 12000) return "text-destructive";
  if (total > 6000) return "text-amber-600";
  return "text-emerald-600";
}

/* ================================================================== */
/* Fixtures — the injected `context` payload, modelled as sources made  */
/* of individually-toggleable parts (so a source can be partially on).  */
/* ================================================================== */

type ContextItem = { id: string; label: string; text: string };
type ContextSource = {
  key: string;
  label: string;
  note: string;
  /** Parts. A single-part source is atomic (no indeterminate state). */
  items: ContextItem[];
};

const seg = (key: string, n: number, make: (i: number) => [string, string]) =>
  Array.from({ length: n }, (_, i) => {
    const [label, text] = make(i);
    return { id: `${key}:${i}`, label, text };
  });

const CONTEXT_SOURCES: ContextSource[] = [
  {
    key: "transcript",
    label: "Transcript",
    note: "clips.text, per segment",
    items: seg("transcript", 6, (i) => [
      `Segment ${i + 1}`,
      `In this segment we look at the satisfies operator. ${"The problem it solves: annotating a variable widens the value to the declared type and you lose the literal information. ".repeat(
        6 + i
      )}`,
    ]),
  },
  {
    key: "chapters",
    label: "Chapters",
    note: "meta.json chapter markers",
    items: [
      ["00:00 The two bad options", 1],
      ["01:12 Annotating widens the type", 2],
      ["02:40 No annotation = no validation", 2],
      ["03:55 Enter satisfies", 3],
      ["05:30 A real config example", 4],
      ["07:10 Gotchas with unions", 2],
    ].map(([label, w], i) => ({
      id: `chapters:${i}`,
      label: label as string,
      text: `${label} — ${"chapter body text describing what happens in this section of the video. ".repeat(
        (w as number) * 3
      )}`,
    })),
  },
  {
    key: "files",
    label: "Repo files",
    note: "readme + exercise/solution sources",
    items: [
      ["explainer/readme.md", 8],
      ["exercise.ts", 5],
      ["exercise.solution.ts", 6],
      ["explainer.ts", 4],
    ].map(([label, w], i) => ({
      id: `files:${i}`,
      label: label as string,
      text: `// ${label}\n${'const config = {\n  routes: { home: "/", about: "/about" },\n  theme: "dark",\n} satisfies Config;\n'.repeat(
        w as number
      )}`,
    })),
  },
  {
    key: "links",
    label: "Links",
    note: "reference URLs on the video",
    items: [
      "https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html",
      "https://github.com/microsoft/TypeScript/pull/46827",
      "https://www.totaltypescript.com/tips/satisfies",
    ].map((url, i) => ({ id: `links:${i}`, label: url, text: url })),
  },
  {
    key: "courseStructure",
    label: "Course structure",
    note: "sections / lessons tree",
    items: [
      {
        id: "courseStructure:0",
        label: "sections / lessons tree",
        text: `Course: TypeScript Wizard\n  Section: Deriving Types\n    Lesson: The satisfies Operator [explainer, problem, solution]\n    Lesson: keyof and typeof\n    Lesson: Indexed Access Types\n  Section: Generics\n`.repeat(
          8
        ),
      },
    ],
  },
  {
    key: "memory",
    label: "Writer memory",
    note: "standing style preferences",
    items: [
      {
        id: "memory:0",
        label: "standing style preferences",
        text: `- Matt prefers examples before theory.\n- House style: no "simply" / "just".\n- AI Hero bodies open with the concrete problem, then mechanics, then a runnable example.\n- Keep paragraphs short; prefer code over prose where it is clearer.\n`.repeat(
          4
        ),
      },
    ],
  },
  {
    key: "fullPath",
    label: "Full path",
    note: "namespacing / source pointer",
    items: [
      {
        id: "fullPath:0",
        label: "source pointer",
        text: `typescript-wizard/deriving-types/the-satisfies-operator/explainer/readme.md`,
      },
    ],
  },
];

/** An em dash + a leading heading are seeded so lint has something to catch. */
const INITIAL_BODY = `## The two bad options

Before \`satisfies\`, configuring a typed object forced a lose-lose choice — you simply couldn't have both.

Annotate it, and TypeScript **widens** every value to the declared type — you can
no longer tell that \`theme\` was \`"dark"\` specifically.

Leave the annotation off, and you keep the narrow inferred type, but nothing
checks that the object actually matches \`Config\`.

## Enter satisfies

\`satisfies\` validates the value against the type without changing the inferred
type:

\`\`\`ts
const config = {
  routes: { home: "/", about: "/about" },
  theme: "dark",
} satisfies Config;
// config.theme is "dark", not string — and it's still checked against Config
\`\`\`
`;

type ChatMsg = { role: "assistant" | "user" | "tool"; text: string };
const INITIAL_CHAT: ChatMsg[] = [
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
    text: "Done — drafted the intro and the “Enter satisfies” section into the document on the right. The widening example comes straight from chapter 3.",
  },
];

/** Field → mode (D6): one mode ⇒ static label, many ⇒ a real selector. */
const MODES = ["article", "skill-building", "newsletter"];

/* ================================================================== */
/* Lint — a trimmed stand-in for use-lint.ts / lint-rules.ts.          */
/* ================================================================== */

type LintRule = {
  id: string;
  name: string;
  count: (doc: string) => number;
  fix: (doc: string) => string;
};

const LINT_RULES: LintRule[] = [
  {
    id: "no-em-dash",
    name: "Em dashes",
    count: (d) => (d.match(/—/g) ?? []).length,
    fix: (d) => d.replace(/\s*—\s*/g, ", "),
  },
  {
    id: "no-llm-phrase",
    name: "LLM phrases",
    count: (d) => (d.match(/\b(simply|just|dive in|unlock)\b/gi) ?? []).length,
    fix: (d) => d.replace(/\b(simply|just|dive in|unlock)\s*/gi, ""),
  },
  {
    id: "no-leading-heading",
    name: "Leading heading",
    count: (d) => (/^\s*#/.test(d) ? 1 : 0),
    fix: (d) => d.replace(/^\s*#+\s.*(\r?\n)+/, ""),
  },
];

function lint(doc: string) {
  const violations = LINT_RULES.map((r) => ({
    rule: r,
    count: r.count(doc),
  })).filter((v) => v.count > 0);
  const total = violations.reduce((a, v) => a + v.count, 0);
  return { violations, total };
}
function fixAll(doc: string) {
  return LINT_RULES.reduce((d, r) => r.fix(d), doc);
}

/* ================================================================== */
/* Context model — enabled parts live in a Set of item ids.            */
/* ================================================================== */

type SourceView = {
  source: ContextSource;
  items: (ContextItem & { on: boolean; tokens: number })[];
  onCount: number;
  /** true | false | "indeterminate" — feeds the checkbox directly. */
  check: boolean | "indeterminate";
  atomic: boolean;
  tokens: number;
};

function useContextModel() {
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(CONTEXT_SOURCES.flatMap((s) => s.items.map((i) => i.id)))
  );

  const toggleItem = useCallback((id: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSource = useCallback((source: ContextSource) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      const allOn = source.items.every((i) => next.has(i.id));
      if (allOn) source.items.forEach((i) => next.delete(i.id));
      else source.items.forEach((i) => next.add(i.id));
      return next;
    });
  }, []);

  const sources = useMemo<SourceView[]>(
    () =>
      CONTEXT_SOURCES.map((source) => {
        const items = source.items.map((i) => ({
          ...i,
          on: enabled.has(i.id),
          tokens: estimateTokens(i.text),
        }));
        const onCount = items.filter((i) => i.on).length;
        const check: boolean | "indeterminate" =
          onCount === 0
            ? false
            : onCount === items.length
              ? true
              : "indeterminate";
        return {
          source,
          items,
          onCount,
          check,
          atomic: items.length === 1,
          tokens: items.reduce((a, i) => (i.on ? a + i.tokens : a), 0),
        };
      }),
    [enabled]
  );

  const totalTokens = sources.reduce((a, s) => a + s.tokens, 0);
  return { sources, toggleItem, toggleSource, totalTokens };
}

type ContextModel = ReturnType<typeof useContextModel>;

/* ================================================================== */
/* The field-bound writer modal.                                       */
/* ================================================================== */

function WriterModal({
  open,
  onClose,
  initialDoc,
  initialChat,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  initialDoc: string;
  initialChat: ChatMsg[];
  onApply: (doc: string, chat: ChatMsg[]) => void;
}) {
  const [doc, setDoc] = useState(initialDoc);
  const [chat, setChat] = useState<ChatMsg[]>(initialChat);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState(MODES[0]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(true);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const ctx = useContextModel();

  // Reseed the working copies each time the field re-opens (D1/D5: field value
  // IS the doc; conversation history is restored to its pre-open state).
  useEffect(() => {
    if (open) {
      setDoc(initialDoc);
      setChat(initialChat);
      setConfirmDiscard(false);
      setPanelOpen(false);
    }
  }, [open, initialDoc, initialChat]);

  const dirty = doc !== initialDoc || chat.length !== initialChat.length;

  // Cancel/close: revert (host state is untouched, so simply dropping the
  // working copies restores the prior conversation) — confirm first if dirty.
  const requestClose = useCallback(() => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [dirty, onClose]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setChat((c) => [
      ...c,
      { role: "user", text },
      {
        role: "assistant",
        text: "Revised the document to match — see the working copy on the right.",
      },
    ]);
    setDraft("");
  }, [draft]);

  const { violations, total: lintTotal } = lint(doc);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && requestClose()}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[82vh] max-h-[780px] w-[94vw] max-w-[1120px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1120px]"
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          requestClose();
        }}
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

          <Button variant="ghost" size="icon" onClick={requestClose}>
            <X className="size-4" />
          </Button>
        </div>

        {/* Body: 2 panes — chat + document */}
        <div className="relative flex min-h-0 flex-1">
          {/* Chat */}
          <div className="flex w-2/5 flex-col border-r">
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {chat.map((m, i) => (
                <ChatBubble key={i} msg={m} />
              ))}
            </div>
            <div className="flex flex-none items-end gap-2 border-t p-3">
              <Textarea
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
                }}
                placeholder="Ask the writer to revise the document…"
                className="max-h-28 min-h-[42px] resize-none"
              />
              <Button size="icon" className="flex-none" onClick={send}>
                <SendIcon className="size-4" />
              </Button>
            </div>
          </div>

          {/* Document */}
          <div className="flex flex-1 flex-col">
            {/* Inline context strip — the locked design. */}
            <InlineContextStrip
              model={ctx}
              onOpenPanel={() => setPanelOpen(true)}
            />

            {/* Document toolbar — mirrors document-panel.tsx. */}
            <div className="flex h-10 flex-none items-center gap-2 border-b px-3 text-xs text-muted-foreground">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  dirty ? "bg-amber-500" : "bg-emerald-500"
                )}
              />
              <FileText className="size-3.5" />
              document · working copy{dirty ? " (unsaved)" : ""}
              <div className="flex-1" />
              {lintTotal > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  title={violations
                    .map((v) => `${v.rule.name}: ${v.count}`)
                    .join(" · ")}
                  onClick={() => setDoc((d) => fixAll(d))}
                >
                  <AlertTriangleIcon className="mr-1 size-4 text-orange-500" />
                  Fix ({lintTotal})
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => setIsEditing((e) => !e)}
              >
                {isEditing ? (
                  <>
                    <EyeIcon className="mr-1 size-4" /> Preview
                  </>
                ) : (
                  <>
                    <PencilIcon className="mr-1 size-4" /> Edit
                  </>
                )}
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {isEditing ? (
                <MarkdownMonacoEditor
                  value={doc}
                  onChange={setDoc}
                  fallback={
                    <div className="p-4 text-sm text-muted-foreground">
                      Loading editor…
                    </div>
                  }
                />
              ) : (
                <div className="scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground h-full overflow-y-auto p-6">
                  <div className="mx-auto max-w-[75ch]">
                    <AIResponse imageBasePath="prototype/the-satisfies-operator">
                      {doc}
                    </AIResponse>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Full-options context panel — toggle individual parts. */}
          <ContextPanel
            open={panelOpen}
            model={ctx}
            onClose={() => setPanelOpen(false)}
          />

          {/* Unsaved-changes confirm — in-modal overlay (no AlertDialog in
              this codebase, and nested Radix dialogs fight over focus). */}
          {confirmDiscard && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-sm">
              <div className="w-[380px] rounded-lg border bg-background p-5 shadow-xl">
                <div className="text-sm font-semibold">
                  Discard unsaved changes?
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  The document and this conversation will revert to how they
                  were before you opened the writer.
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmDiscard(false)}
                  >
                    Keep editing
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setConfirmDiscard(false);
                      onClose();
                    }}
                  >
                    Discard
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer — just Cancel / Apply. */}
        <div className="flex h-14 flex-none items-center justify-end gap-3 border-t bg-muted/40 px-4">
          <Button variant="outline" onClick={requestClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(doc, chat)}>Apply</Button>
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

/* A checkbox glyph, drawn (not interactive) so it can live inside a <button>. */
function CheckGlyph({ state }: { state: boolean | "indeterminate" }) {
  return (
    <span
      className={cn(
        "flex size-3.5 flex-none items-center justify-center rounded-[4px] border",
        state === false
          ? "border-muted-foreground/50"
          : "border-primary bg-primary text-primary-foreground"
      )}
    >
      {state === true && <CheckIcon className="size-3" />}
      {state === "indeterminate" && <MinusIcon className="size-3" />}
    </span>
  );
}

/* The locked design — sources as checkbox chips docked above the document. */
function InlineContextStrip({
  model,
  onOpenPanel,
}: {
  model: ContextModel;
  onOpenPanel: () => void;
}) {
  const tone = tokenTone(model.totalTokens);
  return (
    <div className="flex flex-none flex-wrap items-center gap-1.5 border-b bg-muted/30 px-3 py-2">
      <button
        onClick={onOpenPanel}
        className="mr-1 flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted"
        title="Open the full context panel"
      >
        <Layers className="size-3.5" /> Context
        <span className={cn("font-mono", tone)}>
          {fmtTok(model.totalTokens)}
        </span>
      </button>
      {model.sources.map((s) => (
        <button
          key={s.source.key}
          onClick={() => model.toggleSource(s.source)}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors",
            s.check === false
              ? "bg-transparent text-muted-foreground opacity-70"
              : "bg-background hover:bg-muted"
          )}
          title={`${s.source.note} · ${s.onCount}/${s.items.length} on`}
        >
          <CheckGlyph state={s.check} />
          <span>{s.source.label}</span>
          <span className="font-mono text-muted-foreground">
            {fmtTok(s.tokens)}
          </span>
        </button>
      ))}
    </div>
  );
}

/* Full-options panel — an in-modal sliding panel over the document, so it
   sits alongside the chat instead of dimming the whole modal. */
function ContextPanel({
  open,
  model,
  onClose,
}: {
  open: boolean;
  model: ContextModel;
  onClose: () => void;
}) {
  const tone = tokenTone(model.totalTokens);
  return (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-10 flex w-[420px] flex-col border-l bg-background shadow-xl transition-transform duration-200",
        open ? "translate-x-0" : "pointer-events-none translate-x-full"
      )}
    >
      <div className="flex flex-none items-center gap-2 border-b px-4 py-3">
        <Layers className="size-4" />
        <div className="text-sm font-semibold">Context</div>
        <span className={cn("ml-1 font-mono text-sm", tone)}>
          {fmtTok(model.totalTokens)} tok
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {model.sources.map((s) => (
          <div key={s.source.key} className="mb-1">
            {/* Source header — tri-state; toggles the whole source. */}
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 hover:bg-muted">
              <Checkbox
                checked={s.check}
                onCheckedChange={() => model.toggleSource(s.source)}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm leading-tight">{s.source.label}</div>
                <div className="text-xs text-muted-foreground">
                  {s.source.note}
                </div>
              </div>
              <div className="text-right font-mono text-xs text-muted-foreground">
                {fmtTok(s.tokens)}
              </div>
            </label>
            {/* Parts — only worth showing when the source has more than one. */}
            {!s.atomic && (
              <div className="ml-4 border-l pl-2">
                {s.items.map((i) => (
                  <label
                    key={i.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted",
                      !i.on && "opacity-50"
                    )}
                  >
                    <Checkbox
                      checked={i.on}
                      onCheckedChange={() => model.toggleItem(i.id)}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {i.label}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {fmtTok(i.tokens)}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex-none border-t px-4 py-2 text-xs text-muted-foreground">
        <code className="font-mono">tokens ≈ ⌈bytes / 4⌉</code> (UTF-8). This is
        the <code className="font-mono">context</code> payload the host injects.
      </div>
    </aside>
  );
}

/* ================================================================== */
/* Host page — a faithful copy of the AI Hero form's field layout, so  */
/* the modal is judged against the real page density.                  */
/* ================================================================== */

export default function PrototypeWriterModal() {
  const [body, setBody] = useState(INITIAL_BODY);
  const [chat, setChat] = useState<ChatMsg[]>(INITIAL_CHAT);
  const [modalOpen, setModalOpen] = useState(false);

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
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialDoc={body}
        initialChat={chat}
        onApply={(doc, nextChat) => {
          setBody(doc);
          setChat(nextChat);
          setModalOpen(false);
        }}
      />
    </div>
  );
}
