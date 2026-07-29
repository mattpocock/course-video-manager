// PROTOTYPE — throwaway. Mounted inside the real diagram window route,
// gated on ?variant=. Wayfinder issue #209.
//
//   /diagram-playground/<id>?variant=A   Raycast (dense, grouped, chip)
//   /diagram-playground/<id>?variant=B   Spotlight (wide, thumb-forward)
//   /diagram-playground/<id>?variant=C   Docked inspector (non-modal, preview)
//
// Cmd+K opens it. Nothing renders unless ?variant= is present.

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { Editor } from "tldraw";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePaletteState } from "./use-palette-state";
import { VariantA, NAME as NAME_A } from "./variant-a";
import { VariantB, NAME as NAME_B } from "./variant-b";
import { VariantC, NAME as NAME_C } from "./variant-c";

const VARIANTS = ["A", "B", "C"] as const;
type VariantKey = (typeof VARIANTS)[number];
const NAMES: Record<VariantKey, string> = { A: NAME_A, B: NAME_B, C: NAME_C };

export function PalettePrototypeMount({
  editorRef,
}: {
  editorRef: React.RefObject<Editor | null>;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("variant");
  const active = VARIANTS.includes(raw as VariantKey)
    ? (raw as VariantKey)
    : null;

  const [iconFilterMode, setIconFilterMode] = useState<"manual" | "cmdk">(
    "manual"
  );
  const [iconCap, setIconCap] = useState(200);

  const state = usePaletteState({ editorRef, iconFilterMode, iconCap });

  // Keep the "is anything selected" flag live so the selection-gated action
  // appears and disappears the way it would in the real thing.
  useEffect(() => {
    const id = setInterval(() => {
      const n = editorRef.current?.getSelectedShapeIds().length ?? 0;
      state.setHasSelection(n > 0);
    }, 400);
    return () => clearInterval(id);
  }, [editorRef, state]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (state.open) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!active) return;
      e.preventDefault();
      const i = VARIANTS.indexOf(active);
      const next =
        VARIANTS[
          (i + (e.key === "ArrowRight" ? 1 : VARIANTS.length - 1)) %
            VARIANTS.length
        ]!;
      setSearchParams(
        (p) => {
          p.set("variant", next);
          return p;
        },
        { replace: true, preventScrollReset: true }
      );
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, state.open, setSearchParams]);

  if (!active || import.meta.env.PROD) return null;

  const go = (dir: 1 | -1) => {
    const i = VARIANTS.indexOf(active);
    const next = VARIANTS[(i + dir + VARIANTS.length) % VARIANTS.length]!;
    setSearchParams(
      (p) => {
        p.set("variant", next);
        return p;
      },
      { replace: true, preventScrollReset: true }
    );
  };

  return (
    <>
      {active === "A" && <VariantA state={state} />}
      {active === "B" && <VariantB state={state} />}
      {active === "C" && <VariantC state={state} />}

      {/* Floating switcher + live state readout. Obviously not the design. */}
      <div className="pointer-events-auto fixed bottom-3 left-3 z-[9999] w-[720px] rounded-xl border-2 border-fuchsia-500 bg-black/90 px-3 py-2 font-mono text-[11px] text-fuchsia-200 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            onClick={() => go(-1)}
            className="rounded bg-fuchsia-500/20 p-1 hover:bg-fuchsia-500/40"
            aria-label="Previous variant"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="flex-1 truncate text-center text-fuchsia-100">
            PROTOTYPE {active} — {NAMES[active]}
          </span>
          <button
            onClick={() => go(1)}
            className="rounded bg-fuchsia-500/20 p-1 hover:bg-fuchsia-500/40"
            aria-label="Next variant"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-fuchsia-500/30 pt-1.5">
          <span>
            stack=[{state.stack.join(" › ")}] page=<b>{state.page}</b>
          </span>
          <span>
            q=&quot;{state.query}&quot; value=<b>{state.value || "—"}</b>
          </span>
          <span>selection={state.hasSelection ? "yes" : "empty"}</span>
          <span>icons shown={state.icons.length}</span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-3 text-fuchsia-300">
          <label className="flex items-center gap-1">
            icon filter:
            <button
              onClick={() =>
                setIconFilterMode((m) => (m === "manual" ? "cmdk" : "manual"))
              }
              className="rounded bg-fuchsia-500/20 px-1.5 py-0.5 hover:bg-fuchsia-500/40"
            >
              {iconFilterMode === "manual"
                ? "manual (capped)"
                : "cmdk (all 1,611)"}
            </button>
          </label>
          <label className="flex items-center gap-1">
            cap:
            <input
              type="number"
              value={iconCap}
              min={20}
              step={20}
              onChange={(e) => setIconCap(Number(e.target.value) || 20)}
              className="w-16 rounded bg-fuchsia-500/10 px-1 py-0.5 outline-none"
            />
          </label>
          <button
            onClick={() => state.setOpen(true)}
            className="rounded bg-fuchsia-500/20 px-1.5 py-0.5 hover:bg-fuchsia-500/40"
          >
            open (⌘K)
          </button>
          {state.log[0] && (
            <span className="truncate text-fuchsia-100">→ {state.log[0]}</span>
          )}
        </div>
      </div>
    </>
  );
}
