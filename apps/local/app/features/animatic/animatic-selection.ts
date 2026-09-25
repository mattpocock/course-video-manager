/**
 * Which Clip Mockup the arrow keys point at.
 *
 * SELECTION IS NOT PLAYBACK — the same split the Video page makes. On the Video
 * page the arrows move a selection and nothing plays; RETURN is the key that
 * jumps the playhead to the selection and plays it. The Animatic copies that
 * rule exactly, so one habit works on both screens.
 *
 * `null` means "no selection of its own yet, follow the playhead". That keeps
 * the first ARROW UP after ten seconds of watching relative to what the author
 * is looking at, not to a stale index from before he pressed play.
 */

export type AnimaticSelection = number | null;

/**
 * The index the selection actually points at right now: the author's own
 * choice, or the segment under the playhead while he has not made one.
 *
 * Returns `-1` for an empty Animatic, matching `segmentIndexAtFrame`.
 */
export function resolveSelection(
  selection: AnimaticSelection,
  activeIndex: number
): number {
  return selection ?? activeIndex;
}

/**
 * Move the selection by `delta` segments.
 *
 * With no selection of its own, the first press only ADOPTS the playhead's
 * segment and does not move — the Video page's `press-arrow-up` behaves the
 * same way when nothing is selected, and it stops one keypress jumping two
 * places away from the frame on screen.
 *
 * A press off either end of the Animatic holds where it is rather than
 * wrapping around.
 */
export function moveSelection(props: {
  selection: AnimaticSelection;
  activeIndex: number;
  delta: number;
  count: number;
}): AnimaticSelection {
  if (props.count === 0) return null;

  if (props.selection === null) {
    return props.activeIndex >= 0 ? props.activeIndex : 0;
  }

  const next = props.selection + props.delta;
  if (next < 0 || next >= props.count) return props.selection;
  return next;
}
