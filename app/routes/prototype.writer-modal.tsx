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
 *   • The "Context" button opens a full-options panel — a **tabbed** editor, one
 *     tab per source (each chapter, each file, memory, links…) can be toggled.
 *   • Token counts read as `4.1K`.
 *   • Fewer bars: the strip above the document carries the context chips *and*
 *     the Edit ⇄ Preview toggle; everything else (mode, Regenerate, Clear, the
 *     lint "Fix (N)" control, and writer Settings) is consolidated into the
 *     bottom bar's left cluster, away from Cancel / Apply on the right.
 *   • Cancel reverts the conversation history to what it was before the modal
 *     opened; closing with unsaved changes asks for confirmation first.
 *   • The modal's open state and the active context tab live in the **URL search
 *     params** (`?writer=1&view=context&tab=chapters`) — deep-linkable, and the
 *     browser Back button steps out of a view.
 *
 * Still a prototype: NOT wired to the real writer engine / useChat / endpoints.
 * Chat + document + context sources are hand-authored fixtures. Once this shape is
 * folded into the real modal host built in #1114 (writable-field-component),
 * delete this file.
 */

import { AIResponse } from "components/ui/kibo-ui/ai/response";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
// The screenshot picker is a *document* citizen, not a chat message: the agent
// writes a `<ChooseScreenshot clipIndex={n} alt="…" />` tag into the doc body,
// and it renders inline in the document Preview. Reuse the real preprocessor +
// pure mutation helpers so the prototype matches production exactly.
import { preprocessChooseScreenshotMarkdown } from "@/features/article-writer/choose-screenshot-markdown";
import {
  removeChooseScreenshot,
  replaceChooseScreenshotWithImage,
  updateChooseScreenshotClipIndex,
} from "@/features/article-writer/choose-screenshot-mutations";
import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";
import type { Options } from "react-markdown";
import {
  AlertTriangleIcon,
  ArrowLeft,
  CameraIcon,
  CheckIcon,
  ChevronDown,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  Layers,
  Loader2Icon,
  Maximize2Icon,
  MinusIcon,
  PencilIcon,
  RefreshCwIcon,
  SendIcon,
  SettingsIcon,
  SquareIcon,
  Trash2Icon,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

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

<ChooseScreenshot clipIndex={4} alt="the satisfies config checked in the editor" />
`;

/**
 * A chat message. `kind: "tool"` renders a tool-call card (writeDocument /
 * editDocument). Screenshots are NOT chat messages — see the doc-embedded
 * `<ChooseScreenshot>` below.
 */
type ChatMsg = {
  role: "assistant" | "user" | "tool";
  text: string;
  kind?: "tool";
  streaming?: boolean;
};

/**
 * Fixture "clips" the doc-embedded screenshot picker scrubs through — the
 * analogue of `IndexedClip[]` in the real app. `clipIndex` in the doc tag is
 * 1-based into this list; each clip spans `dur` seconds you can scrub within.
 */
const CLIP_FRAMES = [
  { label: "The two bad options", dur: 7.5, hue: 210 },
  { label: "Annotating widens the type", dur: 6.2, hue: 265 },
  { label: "Enter satisfies", dur: 8.1, hue: 150 },
  { label: "A real config example", dur: 5.4, hue: 25 },
  { label: "Gotchas with unions", dur: 6.8, hue: 340 },
];

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
    kind: "tool",
    text: 'writeDocument(section: "intro") — streamed 412 chars into the document →',
  },
  {
    role: "assistant",
    text: "Done — drafted the intro and the “Enter satisfies” section into the document on the right. The widening example comes straight from chapter 3.",
  },
  {
    role: "assistant",
    text: "I also dropped a **ChooseScreenshot** block into the document after the config example. Switch the document to **Preview** to scrub the clip and pick the frame — it becomes a real image on Apply.",
  },
];

/**
 * Field → mode (D6). The host injects the set of modes a given field is allowed
 * to write in (part of the #1113 `context`/contract); the picker shows a FLAT
 * list of just those. This catalog is only a label/description lookup — the
 * allowed values come from the `modes` prop, not from here.
 */
const MODE_CATALOG: Record<string, { label: string; note: string }> = {
  article: { label: "Article", note: "Educational content and explanations" },
  "article-plan": {
    label: "Article Plan",
    note: "Plan structure with concise bullet points",
  },
  newsletter: {
    label: "Newsletter",
    note: "Friendly preview for the AI Hero audience",
  },
  "skill-building": {
    label: "Skill Building Steps",
    note: "Write steps for a skill-building problem",
  },
  "seo-description": {
    label: "SEO Description",
    note: "Generate an SEO description (max 160 chars)",
  },
};
const modeLabel = (m: string) => MODE_CATALOG[m]?.label ?? m;

/** The AI Hero Body field's contract: the only modes it may be written in. */
const BODY_FIELD_MODES = ["article", "article-plan", "newsletter"];

/* ================================================================== */
/* Lint — a trimmed stand-in for use-lint.ts / lint-rules.ts.          */
/* ================================================================== */

type LintRule = {
  id: string;
  name: string;
  count: (doc: string) => number;
  fix: (doc: string) => string;
};

/** Default banned phrases — editable in the Settings view (feeds the rule). */
const DEFAULT_BANNED = ["simply", "just", "dive in", "unlock"];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rules that don't depend on user settings. */
const STATIC_RULES: LintRule[] = [
  {
    id: "no-em-dash",
    name: "Em dashes",
    count: (d) => (d.match(/—/g) ?? []).length,
    fix: (d) => d.replace(/\s*—\s*/g, ", "),
  },
  {
    id: "no-leading-heading",
    name: "Leading heading",
    count: (d) => (/^\s*#/.test(d) ? 1 : 0),
    fix: (d) => d.replace(/^\s*#+\s.*(\r?\n)+/, ""),
  },
];

/** The banned-phrase rule is built from the Settings list, so the two connect. */
function bannedRule(banned: string[]): LintRule | null {
  const words = banned.map((s) => s.trim()).filter(Boolean);
  if (words.length === 0) return null;
  const body = words.map(escapeRe).join("|");
  return {
    id: "no-llm-phrase",
    name: "Banned phrases",
    count: (d) => (d.match(new RegExp(`\\b(${body})\\b`, "gi")) ?? []).length,
    fix: (d) => d.replace(new RegExp(`\\b(${body})\\b\\s*`, "gi"), ""),
  };
}

function rulesFor(banned: string[]): LintRule[] {
  const b = bannedRule(banned);
  return b ? [...STATIC_RULES, b] : STATIC_RULES;
}

function lint(doc: string, banned: string[]) {
  const violations = rulesFor(banned)
    .map((r) => ({ rule: r, count: r.count(doc) }))
    .filter((v) => v.count > 0);
  const total = violations.reduce((a, v) => a + v.count, 0);
  return { violations, total };
}
function fixAll(doc: string, banned: string[]) {
  return rulesFor(banned).reduce((d, r) => r.fix(d), doc);
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

type LinkItem = { id: string; url: string };

const memorySource = CONTEXT_SOURCES.find((s) => s.key === "memory")!;
const linksSource = CONTEXT_SOURCES.find((s) => s.key === "links")!;

function useContextModel() {
  const [enabled, setEnabled] = useState<Set<string>>(
    () => new Set(CONTEXT_SOURCES.flatMap((s) => s.items.map((i) => i.id)))
  );
  // Writer memory and links are *editable* here, not just toggleable, so they
  // live in state and override the static fixture text.
  const [memoryText, setMemoryText] = useState(() => memorySource.items[0]!.text);
  const [links, setLinks] = useState<LinkItem[]>(() =>
    linksSource.items.map((i) => ({ id: i.id, url: i.text }))
  );
  const linkSeq = useRef(links.length);

  const toggleItem = useCallback((id: string) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSource = useCallback((ids: string[], allOn: boolean) => {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const addLink = useCallback((url: string) => {
    const u = url.trim();
    if (!u) return;
    const id = `links:added-${linkSeq.current++}`;
    setLinks((l) => [...l, { id, url: u }]);
    setEnabled((e) => new Set(e).add(id));
  }, []);

  const removeLink = useCallback((id: string) => {
    setLinks((l) => l.filter((x) => x.id !== id));
    setEnabled((e) => {
      const n = new Set(e);
      n.delete(id);
      return n;
    });
  }, []);

  // The effective parts of a source — memory/links come from live state.
  const itemsFor = useCallback(
    (source: ContextSource): ContextItem[] => {
      if (source.key === "memory")
        return [{ ...source.items[0]!, text: memoryText }];
      if (source.key === "links")
        return links.map((l) => ({ id: l.id, label: l.url, text: l.url }));
      return source.items;
    },
    [memoryText, links]
  );

  const sources = useMemo<SourceView[]>(
    () =>
      CONTEXT_SOURCES.map((source) => {
        const items = itemsFor(source).map((i) => ({
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
    [enabled, itemsFor]
  );

  const totalTokens = sources.reduce((a, s) => a + s.tokens, 0);
  return {
    sources,
    toggleItem,
    toggleSource,
    totalTokens,
    memoryText,
    setMemory: setMemoryText,
    addLink,
    removeLink,
  };
}

type ContextModel = ReturnType<typeof useContextModel>;

/* Mode picker — the write page's dropdown trigger (outline button + chevron,
   items showing name + description), but a FLAT list of only the modes the
   host's contract allows for this field. */
function ModePicker({
  modes,
  mode,
  onModeChange,
}: {
  modes: string[];
  mode: string;
  onModeChange: (m: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="min-w-[180px] justify-between"
        >
          {modeLabel(mode)}
          <ChevronDown className="ml-2 size-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuRadioGroup value={mode} onValueChange={onModeChange}>
          {modes.map((m) => (
            <DropdownMenuRadioItem key={m} value={m}>
              <div>
                <div>{modeLabel(m)}</div>
                <div className="text-xs text-muted-foreground">
                  {MODE_CATALOG[m]?.note}
                </div>
              </div>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ================================================================== */
/* The field-bound writer modal.                                       */
/* ================================================================== */

type WriterView = "writer" | "context" | "settings";

function WriterModal({
  open,
  onClose,
  initialDoc,
  initialChat,
  onApply,
  modes,
  view,
  onView,
  ctxTab,
  onCtxTab,
}: {
  open: boolean;
  onClose: () => void;
  initialDoc: string;
  initialChat: ChatMsg[];
  onApply: (doc: string, chat: ChatMsg[]) => void;
  // The field's allowed modes — injected by the host per the #1113 contract.
  modes: string[];
  // The full-body view + active context tab are URL-backed (search params), so
  // they live in the host and are passed down controlled.
  view: WriterView;
  onView: (v: WriterView) => void;
  ctxTab: string;
  onCtxTab: (k: string) => void;
}) {
  const [doc, setDoc] = useState(initialDoc);
  const [chat, setChat] = useState<ChatMsg[]>(initialChat);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState(modes[0] ?? "article");
  const [model, setModel] = useState("auto");
  const [banned, setBanned] = useState<string[]>(DEFAULT_BANNED);
  const [status, setStatus] = useState<"ready" | "streaming">("ready");
  const [applying, setApplying] = useState(false);
  // The whole modal body swaps between context/settings and the writer; the
  // writer view is never unmounted (so any background streaming survives the
  // swap). `view` itself is controlled by the URL (see props).
  //
  // Default to Preview so the agent-generated <ChooseScreenshot> block in the
  // document is visible on open (it only renders in Preview, like the real app).
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const ctx = useContextModel();
  const streamRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) clearInterval(streamRef.current);
    streamRef.current = null;
    setChat((c) => c.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
    setStatus("ready");
  }, []);

  // Fake a streamed response: a tool-call card, then the assistant reply typed
  // in word-by-word while a line lands in the document. Stop halts it midway.
  const runStream = useCallback(
    (reply: string, docLine: string) => {
      if (streamRef.current) clearInterval(streamRef.current);
      setStatus("streaming");
      setChat((c) => [
        ...c,
        {
          role: "tool",
          kind: "tool",
          text: 'writeDocument(section: "body") — streaming →',
        },
        { role: "assistant", text: "", streaming: true },
      ]);
      setDoc((d) => `${d.replace(/\s*$/, "")}\n\n${docLine}\n`);
      const words = reply.split(" ");
      let i = 0;
      streamRef.current = setInterval(() => {
        i++;
        setChat((c) => {
          const copy = c.slice();
          const last = copy[copy.length - 1];
          if (last) copy[copy.length - 1] = { ...last, text: words.slice(0, i).join(" ") };
          return copy;
        });
        if (i >= words.length) stopStream();
      }, 55);
    },
    [stopStream]
  );

  // Reseed the working copies each time the field re-opens (D1/D5: field value
  // IS the doc; conversation history is restored to its pre-open state).
  useEffect(() => {
    if (open) {
      stopStream();
      setDoc(initialDoc);
      setChat(initialChat);
      setConfirmDiscard(false);
      setApplying(false);
    }
  }, [open, initialDoc, initialChat, stopStream]);

  // Never leave an interval running past unmount.
  useEffect(() => () => stopStream(), [stopStream]);

  const dirty = doc !== initialDoc || chat.length !== initialChat.length;

  // Cancel/close: revert (host state is untouched, so simply dropping the
  // working copies restores the prior conversation) — confirm first if dirty.
  const requestClose = useCallback(() => {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }, [dirty, onClose]);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || status === "streaming") return;
    setChat((c) => [...c, { role: "user", text }]);
    setDraft("");
    runStream(
      "Revised the document to match — tightened the intro and grounded the example in the transcript. See the working copy on the right.",
      "> Revised per your note — intro tightened, example grounded in the transcript."
    );
  }, [draft, status, runStream]);

  const regenerate = useCallback(() => {
    if (status === "streaming") return;
    // Drop the trailing assistant/tool turn and re-run.
    setChat((c) => {
      let end = c.length;
      while (end > 0 && c[end - 1]!.role !== "user") end--;
      return c.slice(0, end);
    });
    runStream(
      "Regenerated — here's a fresh take on the same request, leading harder with the concrete problem.",
      "> Regenerated draft — leads with the concrete problem before the mechanics."
    );
  }, [status, runStream]);

  const clearChat = useCallback(() => {
    stopStream();
    setChat([]);
  }, [stopStream]);

  // The document Preview renders any `<ChooseScreenshot>` tag the agent wrote
  // into the body as an inline, interactive picker — exactly how the real
  // document panel injects it (extraComponents + the shared preprocessor). Its
  // actions are pure string edits on the doc via the real mutation helpers:
  //  • scrub + Capture → replace the tag with `![alt](local:…)` (Cloudinary on Apply)
  //  • Prev / Next     → rewrite clipIndex in place
  //  • Remove          → strip the tag
  const docComponents = useMemo(
    () => ({
      choosescreenshot: ((
        p: HTMLAttributes<HTMLElement> & Record<string, unknown>
      ) => {
        const clipIndex = parseInt(p.clipindex as string, 10);
        const alt = (p.alt as string) ?? "";
        return (
          <DocScreenshotCard
            clipIndex={clipIndex}
            alt={alt}
            isStreaming={status === "streaming"}
            onClipIndexChange={(next) =>
              setDoc((d) =>
                updateChooseScreenshotClipIndex(d, clipIndex, next, alt)
              )
            }
            onCapture={(ts) =>
              setDoc((d) =>
                replaceChooseScreenshotWithImage(
                  d,
                  clipIndex,
                  alt,
                  `local:clip${clipIndex}-${ts.toFixed(1)}`
                )
              )
            }
            onRemove={() =>
              setDoc((d) => removeChooseScreenshot(d, clipIndex, alt))
            }
          />
        );
      }) as unknown,
    }) as Options["components"],
    [status]
  );

  // Apply: if the doc still has local screenshot refs, "upload to Cloudinary"
  // first (rewrite local: → a hosted URL), then write back to the field.
  const handleApply = useCallback(() => {
    const hasLocal = /\]\(local:/.test(doc);
    if (!hasLocal) {
      onApply(doc, chat);
      return;
    }
    setApplying(true);
    setTimeout(() => {
      const uploaded = doc.replace(
        /\]\(local:[^)]+\)/g,
        "](https://res.cloudinary.com/aihero/image/upload/v1/screenshot.png)"
      );
      setApplying(false);
      onApply(uploaded, chat);
    }, 900);
  }, [doc, chat, onApply]);

  const { violations, total: lintTotal } = lint(doc, banned);
  const busy = status === "streaming";

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
        {/* Header — trimmed to identity + streaming state + close. Everything
            operational moved to the bottom bar / context strip. */}
        <div className="flex h-13 flex-none items-center gap-3 border-b bg-muted/40 px-4 py-2">
          <DialogTitle className="text-sm font-semibold">
            AI Hero Body
          </DialogTitle>

          {busy && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              streaming…
            </span>
          )}

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
                <ChatBubble key={i} msg={m} isStreaming={busy} />
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
              {busy ? (
                <Button
                  size="icon"
                  variant="secondary"
                  className="flex-none"
                  onClick={stopStream}
                  title="Stop"
                >
                  <SquareIcon className="size-4" />
                </Button>
              ) : (
                <Button size="icon" className="flex-none" onClick={send}>
                  <SendIcon className="size-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Document */}
          <div className="flex flex-1 flex-col">
            {/* The one bar above the document: just the context chips. */}
            <InlineContextStrip
              model={ctx}
              onOpenPanel={() => onView("context")}
            />

            {/* Edit ⇄ Preview floats over the top-right of the pane, mirroring
                the field's own floating buttons on the host page. */}
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <Button
                variant="secondary"
                size="sm"
                className="absolute right-3 top-2 z-10 h-7 shadow-sm"
                onClick={() => setIsEditing((e) => !e)}
              >
                {isEditing ? (
                  <>
                    <EyeIcon className="mr-1 size-3.5" /> Preview
                  </>
                ) : (
                  <>
                    <PencilIcon className="mr-1 size-3.5" /> Edit
                  </>
                )}
              </Button>
              {/* Edit and Preview share one identical scroll box (same size,
                  same stable scrollbar gutter, same top padding) so toggling
                  between them doesn't move or reflow anything. */}
              {isEditing ? (
                <div className="h-full overflow-hidden">
                  <MarkdownMonacoEditor
                    value={doc}
                    onChange={setDoc}
                    options={{
                      padding: { top: 20, bottom: 20 },
                      scrollBeyondLastLine: false,
                    }}
                    fallback={
                      <div className="p-5 text-sm text-muted-foreground">
                        Loading editor…
                      </div>
                    }
                  />
                </div>
              ) : (
                <div
                  className="scrollbar scrollbar-track-transparent scrollbar-thumb-muted hover:scrollbar-thumb-muted-foreground h-full overflow-y-auto px-6 py-5"
                  style={{ scrollbarGutter: "stable" }}
                >
                  <div className="max-w-[75ch]">
                    <AIResponse
                      imageBasePath="prototype/the-satisfies-operator"
                      extraComponents={docComponents}
                      preprocessMarkdown={preprocessChooseScreenshotMarkdown}
                    >
                      {doc}
                    </AIResponse>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* "Extra stuff" replaces the whole modal body rather than floating
              over it. The writer (chat + document) above stays mounted — these
              covers render on top — so background streaming is never torn out of
              the DOM when you step into Context / Settings and back. */}
          {view === "context" && (
            <ContextView
              model={ctx}
              activeKey={ctxTab}
              onTab={onCtxTab}
              onBack={() => onView("writer")}
            />
          )}
          {view === "settings" && (
            <SettingsView
              model={model}
              onModelChange={setModel}
              banned={banned}
              onBannedChange={setBanned}
              onBack={() => onView("writer")}
            />
          )}

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

        {/* Footer — one bar for everything. Left cluster: mode + chat actions +
            lint + writer settings. Right cluster: Cancel / Apply (Apply uploads
            any captured screenshots to Cloudinary before writing the field
            back). */}
        <div className="flex h-14 flex-none items-center gap-1.5 border-t bg-muted/40 px-3">
          <ModePicker modes={modes} mode={mode} onModeChange={setMode} />

          <div className="mx-0.5 h-6 w-px bg-border" />

          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={busy || chat.length === 0}
            onClick={regenerate}
            title="Regenerate last response"
          >
            <RefreshCwIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={chat.length === 0}
            onClick={clearChat}
            title="Clear chat"
          >
            <Trash2Icon className="size-4" />
          </Button>

          <div className="mx-0.5 h-6 w-px bg-border" />

          {/* Lint display — the "Fix (N)" action, or a clean state. */}
          {lintTotal > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              title={violations
                .map((v) => `${v.rule.name}: ${v.count}`)
                .join(" · ")}
              onClick={() => setDoc((d) => fixAll(d, banned))}
            >
              <AlertTriangleIcon className="mr-1 size-4 text-orange-500" />
              Fix ({lintTotal})
            </Button>
          ) : (
            <span className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
              <CheckIcon className="size-3.5 text-emerald-600" /> No lint issues
            </span>
          )}
          {/* Lint settings (model + banned phrases). */}
          <Button
            variant={view === "settings" ? "secondary" : "ghost"}
            size="icon"
            className="size-8"
            title="Writer settings"
            onClick={() => onView(view === "settings" ? "writer" : "settings")}
          >
            <SettingsIcon className="size-4" />
          </Button>

          <div className="flex-1" />

          <Button variant="outline" onClick={requestClose} disabled={applying}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={applying}>
            {applying ? (
              <>
                <Loader2Icon className="mr-1 size-4 animate-spin" />
                Uploading images…
              </>
            ) : (
              "Apply"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChatBubble({
  msg,
  isStreaming,
}: {
  msg: ChatMsg;
  isStreaming: boolean;
}) {
  if (msg.role === "tool") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 font-mono text-xs text-muted-foreground">
        {isStreaming && <Loader2Icon className="size-3.5 animate-spin" />}
        <span>↳ tool: {msg.text}</span>
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
        {msg.streaming && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-foreground/70 align-middle" />
        )}
      </div>
    </div>
  );
}

/* Doc-embedded screenshot picker — the analogue of the real <ChooseScreenshot>
   from choose-screenshot.tsx. The agent writes a `<ChooseScreenshot clipIndex=…
   alt=… />` tag into the document; in Preview it renders here, INLINE where the
   tag sits in the body (not in chat). Scrub a frame + Capture to bake it into an
   image; Prev/Next picks a different clip; the × removes the block. */
function DocScreenshotCard({
  clipIndex,
  alt,
  isStreaming,
  onClipIndexChange,
  onCapture,
  onRemove,
}: {
  clipIndex: number;
  alt: string;
  isStreaming: boolean;
  onClipIndexChange: (next: number) => void;
  onCapture: (timestamp: number) => void;
  onRemove: () => void;
}) {
  const clip = CLIP_FRAMES[clipIndex - 1];
  const [time, setTime] = useState(0);
  // Reset the scrubber whenever the clip changes.
  useEffect(() => setTime(0), [clipIndex]);

  if (!clip) {
    return (
      <div className="my-4 flex items-center gap-2 rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
        <AlertTriangleIcon className="size-4" />
        Invalid clip index: {clipIndex}
      </div>
    );
  }

  const isFirst = clipIndex <= 1;
  const isLast = clipIndex >= CLIP_FRAMES.length;

  // While the agent is still streaming the doc, the real card shows a "waiting"
  // placeholder rather than letting you capture mid-write.
  if (isStreaming) {
    return (
      <div className="my-4 rounded-lg border bg-muted/50 p-4">
        <p className="mb-2 text-xs text-muted-foreground">
          Clip {clipIndex} — {alt}
        </p>
        <div className="flex aspect-video w-full items-center justify-center rounded-md bg-muted">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Waiting for the response to finish…
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative my-4 rounded-lg border bg-muted/50 p-4">
      <button
        onClick={onRemove}
        className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
        title="Remove screenshot block"
      >
        <X className="size-4" />
      </button>
      <p className="mb-2 text-xs text-muted-foreground">
        Clip {clipIndex} of {CLIP_FRAMES.length} — {alt}
      </p>
      {/* Stand-in for the <video> frame (no real asset in the prototype). */}
      <div
        className="flex aspect-video w-full items-end justify-between rounded-md p-2 text-[11px] font-medium text-white"
        style={{
          background: `linear-gradient(135deg, hsl(${clip.hue} 70% 45%), hsl(${(clip.hue + 40) % 360} 70% 35%))`,
        }}
      >
        <span className="rounded bg-black/40 px-1.5 py-0.5">{clip.label}</span>
        <span className="rounded bg-black/40 px-1.5 py-0.5 tabular-nums">
          {time.toFixed(1)}s
        </span>
      </div>
      {/* Scrub within the clip. */}
      <div className="mt-2 flex items-center gap-2">
        <span className="w-10 text-right font-mono text-[11px] text-muted-foreground">
          {time.toFixed(1)}s
        </span>
        <input
          type="range"
          min={0}
          max={clip.dur}
          step={0.1}
          value={time}
          onChange={(e) => setTime(parseFloat(e.target.value))}
          className="h-1.5 flex-1 accent-primary"
        />
        <span className="w-10 font-mono text-[11px] text-muted-foreground">
          {clip.dur.toFixed(1)}s
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          disabled={isFirst}
          onClick={() => onClipIndexChange(clipIndex - 1)}
        >
          <ChevronLeftIcon className="mr-1 size-3.5" /> Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          disabled={isLast}
          onClick={() => onClipIndexChange(clipIndex + 1)}
        >
          Next <ChevronRightIcon className="ml-1 size-3.5" />
        </Button>
        <div className="flex-1" />
        <Button size="sm" className="h-7" onClick={() => onCapture(time)}>
          <CameraIcon className="mr-1 size-3.5" /> Capture
        </Button>
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
        {/* Fixed-width token slot so the whole strip never reflows as counts
            change — the root of the layout shift when toggling chips. */}
        <span className={cn("w-10 text-right font-mono tabular-nums", tone)}>
          {fmtTok(model.totalTokens)}
        </span>
      </button>
      {model.sources.map((s) => (
        <button
          key={s.source.key}
          onClick={() =>
            model.toggleSource(
              s.items.map((i) => i.id),
              s.check === true
            )
          }
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
          <span className="w-9 text-right font-mono tabular-nums text-muted-foreground">
            {fmtTok(s.tokens)}
          </span>
        </button>
      ))}
    </div>
  );
}

/* A full-body cover with a Back header. Rendered on top of the still-mounted
   writer so stepping into Context / Settings never unmounts it. */
function FullCover({
  title,
  right,
  onBack,
  children,
  footer,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  onBack: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      <div className="flex h-11 flex-none items-center gap-2 border-b px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="Back"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="text-sm font-semibold">{title}</div>
        <div className="flex-1" />
        {right}
      </div>
      <div className="scrollbar scrollbar-track-transparent scrollbar-thumb-muted min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-4">{children}</div>
      </div>
      {footer && (
        <div className="flex-none border-t px-4 py-2 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  );
}

/* Full-body Context view — a tabbed editor, one tab per source. The active tab
   is URL-backed (`?tab=…`). Each tab shows the source's parts to toggle / edit;
   the tab button itself carries the source's tri-state + token count so the
   whole context payload reads at a glance across the row. */
function ContextView({
  model,
  activeKey,
  onTab,
  onBack,
}: {
  model: ContextModel;
  activeKey: string;
  onTab: (k: string) => void;
  onBack: () => void;
}) {
  const tone = tokenTone(model.totalTokens);
  const active =
    model.sources.find((s) => s.source.key === activeKey) ?? model.sources[0]!;

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-background">
      {/* Header */}
      <div className="flex h-11 flex-none items-center gap-2 border-b px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="Back"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="size-4" /> Context
        </div>
        <div className="flex-1" />
        <span className={cn("font-mono text-sm", tone)}>
          {fmtTok(model.totalTokens)} tokens
        </span>
      </div>

      {/* Tab row — one per source, with status glyph + token count. */}
      <div className="scrollbar scrollbar-track-transparent scrollbar-thumb-muted flex flex-none items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
        {model.sources.map((s) => {
          const on = s.source.key === active.source.key;
          return (
            <button
              key={s.source.key}
              onClick={() => onTab(s.source.key)}
              className={cn(
                "flex flex-none items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                on
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.source.label}
              <span className="font-mono tabular-nums opacity-70">
                {fmtTok(s.tokens)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active tab body */}
      <div className="scrollbar scrollbar-track-transparent scrollbar-thumb-muted min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-4">
          <ContextTabBody model={model} view={active} />
        </div>
      </div>

      {/* Footer note */}
      <div className="flex-none border-t px-4 py-2 text-xs text-muted-foreground">
        <code className="font-mono">tokens ≈ ⌈bytes / 4⌉</code> (UTF-8). This is
        the <code className="font-mono">context</code> payload the host injects
        into the agent.
      </div>
    </div>
  );
}

/* The body of one Context tab — a master "include" toggle plus the source's
   parts (editable memory, editable links, per-part toggles, or a read-only
   preview for atomic sources). */
function ContextTabBody({
  model,
  view,
}: {
  model: ContextModel;
  view: SourceView;
}) {
  const s = view;
  const toggleSource = () =>
    model.toggleSource(
      s.items.map((i) => i.id),
      s.check === true
    );

  return (
    <div className="space-y-3">
      {/* Master enable row. */}
      <label className="flex cursor-pointer items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <Checkbox checked={s.check} onCheckedChange={toggleSource} />
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-tight">
            {s.atomic ? "Include this source" : "Include all parts"}
          </div>
          <div className="text-xs text-muted-foreground">
            {s.source.note}
            {!s.atomic && ` · ${s.onCount}/${s.items.length} on`}
          </div>
        </div>
        <div className="text-right font-mono text-xs text-muted-foreground">
          {fmtTok(s.tokens)} tokens
        </div>
      </label>

      {/* Writer memory — editable. */}
      {s.source.key === "memory" && (
        <Textarea
          value={model.memoryText}
          onChange={(e) => model.setMemory(e.target.value)}
          className="min-h-[220px] font-mono text-xs"
        />
      )}

      {/* Links — editable (remove each, add new ones). */}
      {s.source.key === "links" && (
        <div className="space-y-1">
          {s.items.map((i) => (
            <div
              key={i.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted"
            >
              <Checkbox
                checked={i.on}
                onCheckedChange={() => model.toggleItem(i.id)}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-xs",
                  !i.on && "opacity-50"
                )}
              >
                {i.label}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {fmtTok(i.tokens)}
              </span>
              <button
                onClick={() => model.removeLink(i.id)}
                className="text-muted-foreground hover:text-foreground"
                title="Remove link"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <AddLinkRow onAdd={model.addLink} />
        </div>
      )}

      {/* Other multi-part sources: per-part toggles. */}
      {!s.atomic && s.source.key !== "links" && s.source.key !== "memory" && (
        <div className="space-y-0.5">
          {s.items.map((i) => (
            <label
              key={i.id}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted",
                !i.on && "opacity-50"
              )}
            >
              <Checkbox
                checked={i.on}
                onCheckedChange={() => model.toggleItem(i.id)}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1 text-xs">{i.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {fmtTok(i.tokens)}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* Atomic, non-editable sources (course structure, full path): show the
          injected text so the tab isn't empty. */}
      {s.atomic &&
        s.source.key !== "memory" &&
        s.items.map((i) => (
          <pre
            key={i.id}
            className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
          >
            {i.text}
          </pre>
        ))}
    </div>
  );
}

/* Small add-a-link input used inside the Context view's Links source. */
function AddLinkRow({ onAdd }: { onAdd: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const add = () => {
    onAdd(url);
    setUrl("");
  };
  return (
    <div className="flex gap-2 pt-1">
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        placeholder="Add a link…"
        className="h-7 text-xs"
      />
      <Button size="sm" className="h-7" onClick={add}>
        Add
      </Button>
    </div>
  );
}

/* Full-body Settings view — model + banned phrases (which feed the linter). */
function SettingsView({
  model,
  onModelChange,
  banned,
  onBannedChange,
  onBack,
}: {
  model: string;
  onModelChange: (m: string) => void;
  banned: string[];
  onBannedChange: (b: string[]) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState("");
  const addPhrase = () => {
    const p = draft.trim();
    if (p && !banned.includes(p)) onBannedChange([...banned, p]);
    setDraft("");
  };
  return (
    <FullCover
      onBack={onBack}
      title={
        <span className="flex items-center gap-2">
          <SettingsIcon className="size-4" /> Settings
        </span>
      }
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <Label>Model</Label>
          <Select value={model} onValueChange={onModelChange}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                Auto — Haiku to generate, Sonnet to edit
              </SelectItem>
              <SelectItem value="claude-haiku-4-5">
                Haiku 4.5 — fast and cost-effective
              </SelectItem>
              <SelectItem value="claude-sonnet-4-5">
                Sonnet 4.5 — more capable and thorough
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Banned phrases</Label>
          <p className="text-xs text-muted-foreground">
            The linter flags these in the document. Editing them changes the{" "}
            <b>Fix</b> count live.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {banned.map((p) => (
              <span
                key={p}
                className="flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs"
              >
                {p}
                <button
                  onClick={() => onBannedChange(banned.filter((x) => x !== p))}
                  className="text-muted-foreground hover:text-foreground"
                  title={`Remove "${p}"`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {banned.length === 0 && (
              <span className="text-xs text-muted-foreground">
                No banned phrases.
              </span>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addPhrase()}
              placeholder="Add a phrase…"
              className="h-8"
            />
            <Button size="sm" className="h-8" onClick={addPhrase}>
              Add
            </Button>
          </div>
        </div>
      </div>
    </FullCover>
  );
}

/* A long-form field that is itself an editable Monaco editor, with floating
   Preview / Open-in-writer buttons — so you can read or tweak the value inline
   without opening the full writer. */
function BodyField({
  value,
  onChange,
  onOpen,
}: {
  value: string;
  onChange: (v: string) => void;
  onOpen: () => void;
}) {
  const [preview, setPreview] = useState(false);
  return (
    <div className="relative overflow-hidden rounded-md border bg-background">
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 shadow-sm"
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? (
            <>
              <PencilIcon className="mr-1 size-3.5" /> Edit
            </>
          ) : (
            <>
              <EyeIcon className="mr-1 size-3.5" /> Preview
            </>
          )}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 shadow-sm"
          onClick={onOpen}
        >
          <Maximize2Icon className="mr-1 size-3.5" /> Open in writer
        </Button>
      </div>
      <div className="h-[280px]">
        {preview ? (
          <div className="scrollbar scrollbar-track-transparent scrollbar-thumb-muted h-full overflow-y-auto p-4">
            <div className="max-w-[75ch]">
              <AIResponse imageBasePath="prototype/the-satisfies-operator">
                {value}
              </AIResponse>
            </div>
          </div>
        ) : (
          <MarkdownMonacoEditor
            value={value}
            onChange={onChange}
            options={{ padding: { top: 12 } }}
            fallback={
              <div className="p-4 text-sm text-muted-foreground">
                Loading editor…
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* Host page — a faithful copy of the AI Hero form's field layout, so  */
/* the modal is judged against the real page density.                  */
/* ================================================================== */

export default function PrototypeWriterModal() {
  const [body, setBody] = useState(INITIAL_BODY);
  const [chat, setChat] = useState<ChatMsg[]>(INITIAL_CHAT);

  // Modal open state + active full-body view + active context tab all live in
  // the URL search params, so the writer is deep-linkable and Back steps out.
  const [sp, setSp] = useSearchParams();
  const open = sp.get("writer") === "1";
  const view = ((sp.get("view") as WriterView) || "writer") as WriterView;
  const ctxTab = sp.get("tab") || CONTEXT_SOURCES[0]!.key;

  const patch = useCallback(
    (mut: (p: URLSearchParams) => void) =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          mut(next);
          return next;
        },
        { replace: true }
      ),
    [setSp]
  );
  const openWriter = () =>
    patch((p) => {
      p.set("writer", "1");
      p.delete("view");
      p.delete("tab");
    });
  const closeWriter = () =>
    patch((p) => {
      p.delete("writer");
      p.delete("view");
      p.delete("tab");
    });
  const setView = (v: WriterView) =>
    patch((p) => {
      p.set("writer", "1");
      if (v === "writer") {
        p.delete("view");
        p.delete("tab");
      } else {
        p.set("view", v);
      }
    });
  const setCtxTab = (k: string) =>
    patch((p) => {
      p.set("writer", "1");
      p.set("view", "context");
      p.set("tab", k);
    });

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

        {/* The long-form field — a real editable Monaco field with floating
            Preview / Open-in-writer buttons top-right. */}
        <div className="space-y-2">
          <Label>Body (Markdown)</Label>
          <BodyField value={body} onChange={setBody} onOpen={openWriter} />
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
        open={open}
        onClose={closeWriter}
        initialDoc={body}
        initialChat={chat}
        modes={BODY_FIELD_MODES}
        view={view}
        onView={setView}
        ctxTab={ctxTab}
        onCtxTab={setCtxTab}
        onApply={(doc, nextChat) => {
          setBody(doc);
          setChat(nextChat);
          closeWriter();
        }}
      />
    </div>
  );
}
