// PROTOTYPE — wayfinder #135. Throwaway floating variant switcher.
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const VARIANTS: { key: string; name: string }[] = [
  { key: "A", name: "Reflow-in-place grouped rows" },
  { key: "B", name: "Two-pane master / detail" },
  { key: "C", name: "Flat snapshot stream + scope toggle" },
];

export function PrototypeSwitcher() {
  const [params, setParams] = useSearchParams();
  const current = params.get("variant") ?? "A";
  const idx = Math.max(
    0,
    VARIANTS.findIndex((v) => v.key === current)
  );

  const go = (dir: number) => {
    const next = VARIANTS[(idx + dir + VARIANTS.length) % VARIANTS.length]!;
    const p = new URLSearchParams(params);
    p.set("variant", next.key);
    setParams(p, { replace: true });
  };

  const currentVariant = VARIANTS[idx]!;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          (el as HTMLElement).isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/95 px-2 py-1.5 text-emerald-950 shadow-xl">
      <button
        onClick={() => go(-1)}
        className="rounded-full p-1 hover:bg-emerald-400"
        aria-label="Previous variant"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="px-2 text-xs font-semibold whitespace-nowrap">
        {currentVariant.key} — {currentVariant.name}
      </span>
      <button
        onClick={() => go(1)}
        className="rounded-full p-1 hover:bg-emerald-400"
        aria-label="Next variant"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
