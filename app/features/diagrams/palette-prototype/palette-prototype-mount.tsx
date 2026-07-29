// PROTOTYPE — throwaway. Mounted inside the real diagram window route,
// gated on ?variant= so it can never show up by accident. Wayfinder issue #209.
//
//   /diagram-playground/<id>?variant=A
//
// Cmd+K opens it. Nothing renders unless ?variant= is present. The layout
// A/B/C switcher is gone — only one layout survived review — but the state
// readout stays, because seeing the page stack and the icon-filter mode is
// the whole point of running this thing.

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { Editor } from "tldraw";
import { usePaletteState } from "./use-palette-state";
import { Palette } from "./palette";

export function PalettePrototypeMount({
  editorRef,
}: {
  editorRef: React.RefObject<Editor | null>;
}) {
  const [searchParams] = useSearchParams();
  const active = searchParams.has("variant");

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

  if (!active || import.meta.env.PROD) return null;

  return (
    <>
      <Palette state={state} />

      {/* Live state readout. Obviously not the design. */}
      <div className="pointer-events-auto fixed bottom-3 left-3 z-[9999] w-[720px] rounded-xl border-2 border-fuchsia-500 bg-black/90 px-3 py-2 font-mono text-[11px] text-fuchsia-200 shadow-2xl backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            stack=[{state.stack.join(" › ")}] page=<b>{state.page}</b>
          </span>
          <span>
            q=&quot;{state.query}&quot; value=<b>{state.value || "—"}</b>
          </span>
          <span>selection={state.hasSelection ? "yes" : "empty"}</span>
          <span>icons shown={state.icons.length}</span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-3 border-t border-fuchsia-500/30 pt-1.5 text-fuchsia-300">
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
