// ─────────────────────────────────────────────────────────────────────────────
// PROTOTYPE — throwaway. Answers ticket #1268: "what should the top-level TikTok
// surface + low-friction creation flow look like?"
//
// Three structurally-different variants of the TikTok surface, switchable via
// ?variant=A|B|C and ← / → arrow keys. All data is in-memory mock. No mutations.
// Delete this whole file once a direction is chosen.
// ─────────────────────────────────────────────────────────────────────────────

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MicIcon,
  CircleDotIcon,
  SendIcon,
  CheckCircle2Icon,
  Clapperboard,
  Sparkles,
  MoreVertical,
  PlayIcon,
  ChevronLeft,
  ChevronRight,
  Music2,
  Youtube,
} from "lucide-react";
import { useEffect, type ReactElement } from "react";
import { useSearchParams } from "react-router";

// ─── Mock data ───────────────────────────────────────────────────────────────

type Platform = "tiktok" | "shorts";
type Lifecycle = "recorded" | "rendered" | "posted";

type MockTikTok = {
  id: string;
  title: string; // AI-generated from transcript
  description: string; // AI-generated
  durationLabel: string;
  lifecycle: Lifecycle;
  posted: Platform[];
  gradient: string; // stand-in for a portrait thumbnail
};

const TIKTOKS: MockTikTok[] = [
  {
    id: "1",
    title: "The `satisfies` operator explained in 40 seconds",
    description:
      "A whip-through of why `satisfies` beats a type annotation when you want inference AND a constraint.",
    durationLabel: "0:41",
    lifecycle: "posted",
    posted: ["tiktok", "shorts"],
    gradient: "from-fuchsia-500 to-rose-500",
  },
  {
    id: "2",
    title: "Stop using enums. Do this instead.",
    description:
      "Const objects + `as const` give you everything enums do, minus the footguns.",
    durationLabel: "1:02",
    lifecycle: "posted",
    posted: ["tiktok"],
    gradient: "from-indigo-500 to-cyan-500",
  },
  {
    id: "3",
    title: "The TypeScript trick nobody taught you",
    description: "Distributive conditional types, but actually explained.",
    durationLabel: "0:58",
    lifecycle: "rendered",
    posted: [],
    gradient: "from-emerald-500 to-lime-500",
  },
  {
    id: "4",
    title: "Why your generic function won't infer",
    description: "Where the inference site is, and how to move it.",
    durationLabel: "0:37",
    lifecycle: "rendered",
    posted: [],
    gradient: "from-amber-500 to-orange-600",
  },
  {
    id: "5",
    title: "untitled recording — needs a name",
    description: "Transcript captured. Click generate to name & describe.",
    durationLabel: "0:29",
    lifecycle: "recorded",
    posted: [],
    gradient: "from-slate-600 to-slate-800",
  },
  {
    id: "6",
    title: "One line to make any type readonly",
    description:
      "`Readonly<T>` vs `as const` vs `DeepReadonly` — pick the right one.",
    durationLabel: "0:48",
    lifecycle: "posted",
    posted: ["tiktok", "shorts"],
    gradient: "from-violet-600 to-purple-800",
  },
  {
    id: "7",
    title: "The mapped type that saved my codebase",
    description: "Rewriting keys with `as` in a mapped type.",
    durationLabel: "1:11",
    lifecycle: "rendered",
    posted: [],
    gradient: "from-pink-500 to-red-600",
  },
];

// ─── Small shared bits ───────────────────────────────────────────────────────

function PlatformBadges({ posted }: { posted: Platform[] }) {
  if (posted.length === 0) {
    return <span className="text-xs text-muted-foreground">Not posted</span>;
  }
  return (
    <div className="flex items-center gap-1.5">
      {posted.includes("tiktok") && (
        <span className="flex items-center gap-1 text-xs text-foreground/80">
          <Music2 className="w-3 h-3" /> TikTok
        </span>
      )}
      {posted.includes("shorts") && (
        <span className="flex items-center gap-1 text-xs text-foreground/80">
          <Youtube className="w-3 h-3" /> Shorts
        </span>
      )}
    </div>
  );
}

function LifecycleDot({ lifecycle }: { lifecycle: Lifecycle }) {
  const map: Record<Lifecycle, { label: string; cls: string }> = {
    recorded: { label: "Recorded", cls: "bg-amber-500" },
    rendered: { label: "Rendered", cls: "bg-sky-500" },
    posted: { label: "Posted", cls: "bg-emerald-500" },
  };
  const { label, cls } = map[lifecycle];
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("w-2 h-2 rounded-full", cls)} /> {label}
    </span>
  );
}

// A fake portrait thumbnail — coloured 9:16 block with a play affordance.
function PortraitThumb({
  gradient,
  durationLabel,
  className,
}: {
  gradient: string;
  durationLabel: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative aspect-[9/16] rounded-xl bg-gradient-to-br overflow-hidden shrink-0 group",
        gradient,
        className
      )}
    >
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
        <PlayIcon className="w-8 h-8 text-white fill-white" />
      </div>
      <span className="absolute bottom-1.5 right-1.5 text-[10px] font-medium text-white bg-black/50 px-1.5 py-0.5 rounded">
        {durationLabel}
      </span>
    </div>
  );
}

// ─── Variant A — "Recording Studio": creation is the hero ────────────────────

function VariantA() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-2xl font-bold flex items-center gap-2 mb-6">
          <Music2 className="w-6 h-6" /> TikToks
        </h1>

        {/* The hero: press-to-talk record panel */}
        <div className="rounded-2xl border bg-card p-8 mb-10 flex flex-col items-center text-center">
          <p className="text-sm text-muted-foreground mb-5">
            Got an idea? Hit record and start talking. We&apos;ll name it and
            write the description from what you say.
          </p>
          <button className="relative w-24 h-24 rounded-full bg-rose-600 hover:bg-rose-500 transition-colors flex items-center justify-center shadow-lg shadow-rose-600/30">
            <MicIcon className="w-10 h-10 text-white" />
            <span className="absolute -inset-1.5 rounded-full border-2 border-rose-500/40 animate-pulse" />
          </button>
          <p className="mt-4 text-lg font-semibold">Press to talk</p>
          <p className="text-xs text-muted-foreground mt-1">
            OBS connected · portrait profile · silence auto-splits clips
          </p>
        </div>

        {/* Recent TikToks as a horizontal filmstrip */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground">Recent</h2>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
          {TIKTOKS.map((t) => (
            <div key={t.id} className="w-40 shrink-0">
              <PortraitThumb
                gradient={t.gradient}
                durationLabel={t.durationLabel}
              />
              <p className="text-sm font-medium mt-2 line-clamp-2 leading-snug">
                {t.title}
              </p>
              <div className="mt-1.5">
                <PlatformBadges posted={t.posted} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Variant B — "Portrait Gallery": the grid is the hero ────────────────────

function VariantB() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Music2 className="w-6 h-6" /> TikToks
          </h1>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
          {/* First tile is the creation affordance, inline in the grid */}
          <button className="aspect-[9/16] rounded-xl border-2 border-dashed border-rose-500/40 hover:border-rose-500 hover:bg-rose-500/5 transition-colors flex flex-col items-center justify-center gap-2 text-rose-500">
            <MicIcon className="w-8 h-8" />
            <span className="text-sm font-medium">Record</span>
          </button>

          {TIKTOKS.map((t) => (
            <div key={t.id} className="group">
              <PortraitThumb
                gradient={t.gradient}
                durationLabel={t.durationLabel}
              />
              <div className="mt-2">
                <p className="text-sm font-medium line-clamp-2 leading-snug">
                  {t.title}
                </p>
                <div className="flex items-center justify-between mt-1.5">
                  <LifecycleDot lifecycle={t.lifecycle} />
                  <PlatformBadges posted={t.posted} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Variant C — "Pipeline Feed": metadata + lifecycle rows ───────────────────

function VariantC() {
  return (
    <div className="flex-1 overflow-y-auto relative">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Music2 className="w-6 h-6" /> TikToks
          </h1>
          <span className="text-sm text-muted-foreground">
            {TIKTOKS.length} shorts ·{" "}
            {TIKTOKS.filter((t) => t.lifecycle === "posted").length} posted
          </span>
        </div>

        <div className="space-y-3">
          {TIKTOKS.map((t) => (
            <div
              key={t.id}
              className="flex gap-4 items-center rounded-xl border bg-card p-3 hover:bg-accent/40 transition-colors"
            >
              <PortraitThumb
                gradient={t.gradient}
                durationLabel={t.durationLabel}
                className="w-16"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{t.title}</p>
                  {t.title.startsWith("untitled") && (
                    <button className="flex items-center gap-1 text-xs text-rose-500 shrink-0">
                      <Sparkles className="w-3 h-3" /> Generate name
                    </button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground truncate mt-0.5">
                  {t.description}
                </p>
                <div className="flex items-center gap-4 mt-2">
                  <LifecycleDot lifecycle={t.lifecycle} />
                  <PlatformBadges posted={t.posted} />
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {t.lifecycle === "rendered" && (
                  <Button size="sm" variant="outline">
                    <SendIcon className="w-3.5 h-3.5 mr-1.5" /> Post
                  </Button>
                )}
                {t.lifecycle === "recorded" && (
                  <Button size="sm" variant="outline">
                    <Clapperboard className="w-3.5 h-3.5 mr-1.5" /> Render
                  </Button>
                )}
                {t.lifecycle === "posted" && (
                  <span className="flex items-center gap-1 text-xs text-emerald-500 mr-1">
                    <CheckCircle2Icon className="w-4 h-4" /> Live
                  </span>
                )}
                <button className="p-1.5 rounded-md hover:bg-accent">
                  <MoreVertical className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sticky record FAB */}
      <button className="fixed bottom-8 right-8 h-14 pl-4 pr-5 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-colors">
        <CircleDotIcon className="w-5 h-5" />
        <span className="font-medium">Record</span>
      </button>
    </div>
  );
}

// ─── Switcher (dev-only) ─────────────────────────────────────────────────────

const VARIANTS: Record<string, { name: string; el: () => ReactElement }> = {
  A: { name: "Recording Studio (creation is the hero)", el: VariantA },
  B: { name: "Portrait Gallery (grid is the hero)", el: VariantB },
  C: { name: "Pipeline Feed (metadata + lifecycle rows)", el: VariantC },
};
const KEYS = Object.keys(VARIANTS);

function PrototypeSwitcher({
  current,
  onChange,
}: {
  current: string;
  onChange: (k: string) => void;
}) {
  const idx = KEYS.indexOf(current);
  const go = (delta: number) =>
    onChange(KEYS[(idx + delta + KEYS.length) % KEYS.length]!);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  if (import.meta.env.PROD) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full bg-zinc-900 text-white pl-2 pr-2 py-2 shadow-xl border border-white/10">
      <button
        onClick={() => go(-1)}
        className="p-1.5 rounded-full hover:bg-white/10"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-sm font-medium px-1 min-w-[16rem] text-center">
        {current} — {VARIANTS[current]!.name}
      </span>
      <button
        onClick={() => go(1)}
        className="p-1.5 rounded-full hover:bg-white/10"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

export default function TikToksPrototype() {
  const [params, setParams] = useSearchParams();
  const current = KEYS.includes(params.get("variant") ?? "")
    ? params.get("variant")!
    : "A";
  const Variant = VARIANTS[current]!.el;

  return (
    <div className="flex-1 flex flex-col bg-background text-foreground">
      <Variant />
      <PrototypeSwitcher
        current={current}
        onChange={(k) => setParams({ variant: k }, { replace: true })}
      />
    </div>
  );
}
