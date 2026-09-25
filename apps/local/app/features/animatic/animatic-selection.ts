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
 *
 * IT STEPS OVER A FOLDED CHAPTER'S ROWS. `hiddenIndices` names the rows the
 * sidebar is not drawing (see `hiddenRowIndices` in `animatic-collapse.ts`), and
 * the move carries on in its own direction until it finds a row on screen. A
 * press that finds none before the end of the Animatic holds where it is, so
 * with every Chapter folded away the selection does not move at all. Omit the
 * set — or hand over an empty one — and the move is what it always was.
 */
export function moveSelection(props: {
  selection: AnimaticSelection;
  activeIndex: number;
  delta: number;
  count: number;
  /** The rows a folded Chapter has taken off the screen. */
  hiddenIndices?: ReadonlySet<number>;
}): AnimaticSelection {
  if (props.count === 0) return null;

  if (props.selection === null) {
    // The playhead's own Chapter is always open — `expandChapterAtPlayhead`
    // sees to that — so the row this adopts is on screen.
    return props.activeIndex >= 0 ? props.activeIndex : 0;
  }

  const step = props.delta < 0 ? -1 : 1;
  let next = props.selection + props.delta;
  while (next >= 0 && next < props.count && props.hiddenIndices?.has(next)) {
    next += step;
  }
  if (next < 0 || next >= props.count) return props.selection;
  return next;
}

/**
 * The row HOME and END select: the first or the last Clip Mockup that is
 * actually on screen.
 *
 * Same rule as the arrows — a hidden row is never selected — so END with the
 * last Chapter folded away lands on the last row the author can see, not on the
 * row behind the fold. `null` means there is nothing to select at all: an empty
 * Animatic, or every row behind a fold. The caller holds its selection then.
 */
export function selectEdge(props: {
  edge: "first" | "last";
  count: number;
  hiddenIndices?: ReadonlySet<number>;
}): AnimaticSelection {
  if (props.count === 0) return null;

  const step = props.edge === "first" ? 1 : -1;
  let index = props.edge === "first" ? 0 : props.count - 1;
  while (index >= 0 && index < props.count && props.hiddenIndices?.has(index)) {
    index += step;
  }
  return index >= 0 && index < props.count ? index : null;
}
