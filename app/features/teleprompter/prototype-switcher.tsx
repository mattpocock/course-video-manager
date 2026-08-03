/**
 * PROTOTYPE — throwaway. Delete with the rest of the `prototype-*` files.
 *
 * Flips between the status-display variants on the live glass. Deliberately
 * loud and ugly: it must not be mistaken for part of the design being judged.
 * Hidden in production builds so a stray merge can't ship it.
 *
 * Left/right arrows cycle the variant; `f` toggles the Q6 freeze (whether the
 * numbers may change while you're mid-sentence). Both live in the URL so a
 * reload mid-take doesn't lose which one you were looking at. The teleprompter
 * already binds j/k/up/down/space/p/r, so these keys stay clear of it.
 */
import { useEffect } from "react";
import { useSearchParams } from "react-router";
import {
  VARIANTS,
  VARIANT_NAMES,
  type Variant,
} from "./prototype-status-variants";

const isProduction = import.meta.env.PROD;

export function usePrototypeVariant(): {
  variant: Variant;
  frozen: boolean;
  enabled: boolean;
  cycle: (delta: number) => void;
  toggleFreeze: () => void;
} {
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get("variant");
  const enabled = raw !== null && !isProduction;
  const variant = (VARIANTS as readonly string[]).includes(raw ?? "")
    ? (raw as Variant)
    : "A";
  // Held-until-silence is the recommendation, so it's the default.
  const frozen = searchParams.get("freeze") !== "0";

  const update = (fn: (params: URLSearchParams) => void) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        fn(params);
        return params;
      },
      { replace: true, preventScrollReset: true }
    );

  const cycle = (delta: number) => {
    const i = VARIANTS.indexOf(variant);
    const next =
      VARIANTS[(i + delta + VARIANTS.length) % VARIANTS.length] ?? "A";
    update((p) => p.set("variant", next));
  };

  const toggleFreeze = () => update((p) => p.set("freeze", frozen ? "0" : "1"));

  useEffect(() => {
    if (!enabled) return;
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
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        cycle(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        cycle(1);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFreeze();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return { variant, frozen, enabled, cycle, toggleFreeze };
}

export function PrototypeSwitcher(props: {
  variant: Variant;
  frozen: boolean;
  counts: { pending: number; settled: number; orphaned: number };
  onCycle: (delta: number) => void;
  onToggleFreeze: () => void;
}) {
  if (isProduction) return null;

  return (
    <div className="fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-fuchsia-500 bg-fuchsia-950/95 px-2 py-1.5 font-mono text-xs text-fuchsia-100 shadow-lg">
      <button
        type="button"
        onClick={() => props.onCycle(-1)}
        className="rounded-full px-2 py-0.5 hover:bg-fuchsia-800"
      >
        ←
      </button>

      <span className="min-w-[9ch] text-center">
        {props.variant} — {VARIANT_NAMES[props.variant]}
      </span>

      <button
        type="button"
        onClick={() => props.onCycle(1)}
        className="rounded-full px-2 py-0.5 hover:bg-fuchsia-800"
      >
        →
      </button>

      <span className="mx-1 h-4 w-px bg-fuchsia-600" />

      <button
        type="button"
        onClick={props.onToggleFreeze}
        className="rounded-full px-2 py-0.5 hover:bg-fuchsia-800"
        title="Whether the numbers may change while you are speaking (Q6)"
      >
        {props.frozen ? "held til silence" : "live"}
      </button>

      <span className="mx-1 h-4 w-px bg-fuchsia-600" />

      {/* The raw truth, so a variant that hides something is obvious. */}
      <span className="tabular-nums text-fuchsia-300">
        p{props.counts.pending} s{props.counts.settled} o{props.counts.orphaned}
      </span>
    </div>
  );
}
