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
 * rather than a row getting denser. Colours are the editor's own vocabulary
 * from `recording-session-panel.tsx` (amber = orphaned, red = archived), so
 * there is no second language to learn while filming. Nothing animates: #1435
 * and the commit that stripped the beats view's 1/N counter both say motion in
 * the filming field of view is the thing to avoid.
 */
import { useRef } from "react";
import type {
  CaptureStatus,
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
  // In flight, and probably fine. Warm, like the body type — present without
  // asking for anything.
  pending: TYPE.color,
  // No database clip is coming. This is the one worth stopping for.
  orphaned: "var(--color-amber-400)",
  // Deleted by hand, still waiting to be reconciled. Nothing to do.
  deleted: "var(--color-red-500)",
};

export function isSpeaking(capture: CaptureStatus): boolean {
  return (
    capture === "speaking-detected" ||
    capture === "long-enough-speaking-for-clip-detected"
  );
}

/**
 * Q6(b): hold the last value taken while he wasn't talking, so the display
 * never changes mid-sentence. Toggleable so live and held can be felt back to
 * back.
 */
export function useHeldUnresolved(
  unresolved: UnresolvedClips,
  capture: CaptureStatus,
  frozen: boolean
): UnresolvedClips {
  const held = useRef(unresolved);
  if (!frozen || !isSpeaking(capture)) held.current = unresolved;
  return held.current;
}

export function UnresolvedClipsDisplay(props: { unresolved: UnresolvedClips }) {
  // Nothing unresolved means nothing on the glass. The empty state is the
  // point, so it isn't drawn as an empty container.
  if (props.unresolved.length === 0) return null;

  const overflow = Math.max(0, props.unresolved.length - MAX_DOTS);
  // Keep the newest when overflowing: the oldest are already lost causes.
  const shown = props.unresolved.slice(-MAX_DOTS);

  const rows: UnresolvedClips[] = [];
  for (let i = 0; i < shown.length; i += PER_ROW) {
    rows.push(shown.slice(i, i + PER_ROW));
  }

  return (
    <div className={ANCHOR}>
      <div className="flex flex-col gap-2.5">
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-2.5">
            {row.map((state, i) => (
              <div
                key={`${rowIndex}-${i}`}
                className="size-4 rounded-full"
                style={{ background: DOT_COLOUR[state] }}
              />
            ))}
          </div>
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
