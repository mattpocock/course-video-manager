/**
 * PROTOTYPE — throwaway.
 *
 * The thing to look at when there is nothing to read. Sits above every variant
 * at the same fixed screen position, so eyeline stays put whether the script is
 * scrolling, stepping, or empty.
 *
 * The open question this exists to answer: how loud does it need to be before
 * it holds a gaze, and how quiet before it stops pulling attention off the
 * words? Hence five options rather than one.
 */

export const RETICULE_STYLES = [
  "off",
  "dot",
  "ring",
  "brackets",
  "crosshair",
  "halo",
] as const;

export type ReticuleStyle = (typeof RETICULE_STYLES)[number];

export function isReticuleStyle(value: string | null): value is ReticuleStyle {
  return !!value && (RETICULE_STYLES as readonly string[]).includes(value);
}

export function FocusReticule(props: {
  style: ReticuleStyle;
  /** Vertical position as a percentage of viewport height. */
  topPct: number;
}) {
  if (props.style === "off") return null;

  return (
    <div
      className="pointer-events-none fixed left-1/2 z-50 -translate-x-1/2 -translate-y-1/2"
      style={{ top: `${props.topPct}%` }}
      aria-hidden
    >
      {props.style === "dot" && (
        <div className="h-3 w-3 rounded-full bg-red-500 shadow-[0_0_12px_4px_rgba(239,68,68,0.55)]" />
      )}

      {props.style === "ring" && (
        <div className="h-14 w-14 rounded-full border-2 border-red-500/70 shadow-[0_0_16px_2px_rgba(239,68,68,0.35)]">
          <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500" />
        </div>
      )}

      {props.style === "brackets" && (
        <div className="relative h-20 w-[70vw] max-w-5xl">
          <span className="absolute left-0 top-0 h-full w-6 border-y-2 border-l-2 border-amber-400/80" />
          <span className="absolute right-0 top-0 h-full w-6 border-y-2 border-r-2 border-amber-400/80" />
        </div>
      )}

      {props.style === "crosshair" && (
        <div className="relative h-24 w-24">
          <span className="absolute left-1/2 top-0 h-8 w-px -translate-x-1/2 bg-red-500/80" />
          <span className="absolute bottom-0 left-1/2 h-8 w-px -translate-x-1/2 bg-red-500/80" />
          <span className="absolute left-0 top-1/2 h-px w-8 -translate-y-1/2 bg-red-500/80" />
          <span className="absolute right-0 top-1/2 h-px w-8 -translate-y-1/2 bg-red-500/80" />
          <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500" />
        </div>
      )}

      {props.style === "halo" && (
        <div className="h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(248,113,113,0.22)_0%,rgba(248,113,113,0.08)_45%,transparent_70%)]" />
      )}
    </div>
  );
}
