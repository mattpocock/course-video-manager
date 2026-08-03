/**
 * PROTOTYPE — throwaway. Delete with the rest of the `prototype-*` files.
 *
 * What's left of the variant switcher now that the dots have won: a toggle for
 * the one question still open (may the display change while you're
 * mid-sentence?) and a raw readout of what the editor actually said, so a
 * display showing nothing can be told apart from a channel carrying nothing.
 *
 * Deliberately loud and ugly: it must not be mistaken for part of the design
 * being judged. Hidden in production builds so a stray merge can't ship it.
 *
 * `f` toggles the freeze, and it lives in the URL so a reload mid-take doesn't
 * lose it. The teleprompter already binds j/k/up/down/space/p/r, so `f` stays
 * clear of it.
 */
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import type { UnresolvedClips } from "@/lib/teleprompter-protocol";

const isProduction = import.meta.env.PROD;

export function usePrototypeControls(): {
  frozen: boolean;
  toggleFreeze: () => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();

  // Held-until-silence is the recommendation, so it's the default.
  const frozen = searchParams.get("freeze") !== "0";

  const toggleFreeze = () =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("freeze", frozen ? "0" : "1");
        return params;
      },
      { replace: true, preventScrollReset: true }
    );

  useEffect(() => {
    if (isProduction) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFreeze();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return { frozen, toggleFreeze };
}

export function PrototypeControls(props: {
  frozen: boolean;
  unresolved: UnresolvedClips;
  onToggleFreeze: () => void;
}) {
  if (isProduction) return null;

  const counts = props.unresolved.reduce<Record<string, number>>(
    (acc, state) => ({ ...acc, [state]: (acc[state] ?? 0) + 1 }),
    {}
  );

  return (
    <div className="fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-fuchsia-500 bg-fuchsia-950/95 px-2 py-1.5 font-mono text-xs text-fuchsia-100 shadow-lg">
      <button
        type="button"
        onClick={props.onToggleFreeze}
        className="rounded-full px-2 py-0.5 hover:bg-fuchsia-800"
        title="Whether the dots may change while you are speaking"
      >
        {props.frozen ? "held til silence" : "live"}
      </button>

      <span className="mx-1 h-4 w-px bg-fuchsia-600" />

      {/* The raw truth, so "no dots" and "no data" can be told apart. */}
      <span className="tabular-nums text-fuchsia-300">
        pending {counts.pending ?? 0} · orphaned {counts.orphaned ?? 0} ·
        deleted {counts.deleted ?? 0}
      </span>
    </div>
  );
}
