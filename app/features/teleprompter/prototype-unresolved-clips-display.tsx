/**
 * PROTOTYPE — throwaway. Delete with the rest of the `prototype-*` files.
 *
 * One dot per optimistic clip that hasn't found a database clip yet.
 *
 * This is a leak detector, not a scoreboard. A clip that pairs successfully
 * disappears from here, so the healthy resting state is *nothing on the glass*
 * — and a dot that stays put is the frontend speech detector having heard
 * something the backend's silence detection didn't agree with.
 *
 * Three wide, growing downward, so a pile-up reads as a column getting longer
 * rather than a row getting denser — and exactly as wide as the capture
 * indicator above it, so the two read as one instrument rather than two things
 * that happen to be near each other.
 *
 * Colours are the editor's own vocabulary from `recording-session-panel.tsx`
 * (amber = orphaned, red = archived), so there is no second language to learn
 * while filming.
 *
 * Updates live, deliberately. #1435 says motion in the filming field of view
 * is the thing to avoid, and that still holds for anything decorative — but a
 * dot appearing the instant the capture indicator turns green *is* the signal
 * here, so holding it back until silence would remove the only thing this
 * display is for. Nothing animates; marks simply appear and disappear.
 */
import type {
  UnresolvedClips,
  UnresolvedClipState,
} from "@/lib/teleprompter-protocol";
import { TYPE } from "./teleprompter-settings";

/** Under the capture dot: top-4 (1rem) + size-14 (3.5rem) + a gap. */
const ANCHOR = "pointer-events-none absolute left-4 top-20 z-40 select-none";

const PER_ROW = 3;
/**
 * A cap only so a runaway leak can't march off the bottom of the panel. Twelve
 * rows is already far past the point where something has gone wrong.
 */
const MAX_DOTS = PER_ROW * 12;

const DOT_COLOUR: Record<UnresolvedClipState, string> = {
  // In flight, and probably fine. Appears the moment the frontend detects the
  // clip — the same instant it shows up in the editor's session panel — so the
  // glass and the editor never disagree about what has been heard.
  pending: "#fff",
  // No database clip is coming. This is the one worth stopping for.
  orphaned: "var(--color-amber-400)",
  // Deleted by hand, still waiting to be reconciled. Nothing to do.
  deleted: "var(--color-red-500)",
};

export function UnresolvedClipsDisplay(props: { unresolved: UnresolvedClips }) {
  // Nothing unresolved means nothing on the glass. The empty state is the
  // point, so it isn't drawn as an empty container.
  if (props.unresolved.length === 0) return null;

  const overflow = Math.max(0, props.unresolved.length - MAX_DOTS);
  // Keep the newest when overflowing: the oldest are already lost causes.
  const shown = props.unresolved.slice(-MAX_DOTS);

  return (
    <div className={ANCHOR}>
      {/*
        `w-14` is the capture indicator's `size-14`, and the dots divide that
        width rather than being sized independently — so the column lines up
        with the circle above it whatever the gap is set to. Wrapping is the
        grid's job, which is why there is no row chunking here.
      */}
      <div
        className="grid w-14 gap-1.5"
        style={{ gridTemplateColumns: `repeat(${PER_ROW}, 1fr)` }}
      >
        {shown.map((state, i) => (
          <div
            key={i}
            className="aspect-square w-full rounded-full"
            style={{ background: DOT_COLOUR[state] }}
          />
        ))}
      </div>

      {overflow > 0 && (
        <div
          className="mt-2.5"
          style={{
            fontFamily: TYPE.fontFamily,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 300,
            fontSize: 13,
            color: TYPE.cueColor,
          }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
