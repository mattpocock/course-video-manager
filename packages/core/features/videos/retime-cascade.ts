/**
 * The retiming cascade — what happens to a Clip's Clip-relative children when
 * the Clip itself is recut (`cvm clip update --start/--end`).
 *
 * A Transcript Word and an Overlay both store their position as an offset from
 * the Clip's own start, so moving the Clip's in-point moves the footage out
 * from under every one of them: a word recorded at 4.0s into a Clip that now
 * begins 2.5s later is spoken at 1.5s. Left alone, every stored offset would
 * silently point at the wrong moment. So every offset is shifted by the same
 * delta as the recut, and the ones the new, shorter Clip can no longer hold
 * are dealt with.
 *
 * The two children are dealt with DIFFERENTLY, and that asymmetry is the whole
 * point of this module:
 *
 *   - A Transcript Word is read-side data, reproducible at any time by
 *     re-transcribing the Clip. One that no longer fits is DROPPED, because a
 *     word claiming a moment that no longer exists inside the Clip is worse
 *     than no word at all.
 *   - An Overlay carries hand-authored content (a Definition Card's title and
 *     description). One that no longer fits is CLAMPED back inside the Clip,
 *     never deleted — an unrelated trim must not be able to destroy writing
 *     nobody asked it to touch. A clamped Overlay is in the wrong place and
 *     visibly so; a deleted one is just gone.
 *
 * Pure on purpose: no Effect, no DB. The arithmetic is the part worth pinning
 * down (retime-cascade.test.ts), and the transaction that applies it
 * (db-clip-retime.server.ts) is then only plumbing.
 */

/** A Clip's cut into its source file. Both ends in source-file seconds. */
export interface ClipRange {
  readonly sourceStartTime: number;
  readonly sourceEndTime: number;
}

/**
 * The one description of a recut every child offset is moved by.
 *
 * `delta` is what to ADD to a Clip-relative offset: pulling the in-point
 * later (a trim off the head) makes it negative, pulling it earlier makes it
 * positive. Moving only the out-point leaves it at `0` — but `newDuration`
 * still changes, which is why the two travel together and why a `--end`-only
 * recut still drops and clamps.
 */
export interface RetimeShift {
  readonly delta: number;
  readonly newDuration: number;
}

/**
 * Read the shift off the before/after cut.
 *
 * The delta comes from the START of the cut and nothing else: a Clip-relative
 * offset is measured from the in-point, so where the out-point lands cannot
 * move a word. The out-point only decides how much room is left.
 */
export const retimeShift = (
  previous: ClipRange,
  next: ClipRange
): RetimeShift => ({
  delta: previous.sourceStartTime - next.sourceStartTime,
  newDuration: next.sourceEndTime - next.sourceStartTime,
});

/** A Clip-relative spoken word. The DB row is a superset of this. */
export interface ShiftableWord {
  readonly start: number;
  readonly end: number;
}

/**
 * Shift every word, keeping only the ones the recut Clip still contains.
 *
 * "Contains" is judged on the WHOLE word, both ends: a word half outside the
 * new cut is half unspoken in the footage, and there is no honest offset to
 * give it. A word ending exactly at `newDuration` is kept — its last instant
 * is the Clip's last instant, which is inside the Clip, not past it.
 *
 * The word's own fields (`text`, and whatever else the caller's row carries)
 * ride through untouched; only `start`/`end` move.
 */
export const shiftTranscriptWords = <W extends ShiftableWord>(
  words: ReadonlyArray<W>,
  shift: RetimeShift
): W[] =>
  words
    .map((word) => ({
      ...word,
      start: word.start + shift.delta,
      end: word.end + shift.delta,
    }))
    .filter(
      (word) =>
        word.start >= 0 &&
        word.start < shift.newDuration &&
        word.end <= shift.newDuration
    );

/**
 * Shift one Overlay's anchor, clamping it back inside the recut Clip rather
 * than letting it fall out of it.
 *
 * The two bounds are the two things an anchor can be pushed past:
 *
 *   - Before the Clip's start — clamped to `0`, the first moment there is.
 *   - Past the Clip's end — clamped to `newDuration`, the Clip's last moment.
 *     This also satisfies the "never past the Video's last frame" rule the
 *     Overlay carries, and satisfies it without having to know the Video at
 *     all: a Clip's end never lies beyond its Video's end, and for the Video's
 *     FINAL Clip the two are the same instant. Clamping to the Video's last
 *     frame directly would be strictly worse for every other Clip — it would
 *     fling an Overlay off the moment it was authored for and onto the end of
 *     a forty-minute video.
 *
 * A degenerate Clip (`newDuration <= 0`) can hold nothing, so its anchor
 * collapses to `0`; `Math.max` last is what guarantees that.
 */
export const clampOverlayAnchor = (at: number, shift: RetimeShift): number =>
  Math.max(0, Math.min(at + shift.delta, shift.newDuration));

/** An Overlay's identity and anchor. The DB row is a superset of this. */
export interface ShiftableOverlay {
  readonly id: string;
  readonly at: number;
}

/**
 * The anchors that actually MOVED, as `{ id, at }` pairs.
 *
 * Unmoved Overlays are left out so a recut that changes nothing for them
 * (the common case — `delta` of `0`, anchor comfortably inside) issues no
 * UPDATE at all. Title and description are never in this result, and so can
 * never be rewritten by a recut.
 */
export const shiftOverlayAnchors = <O extends ShiftableOverlay>(
  overlays: ReadonlyArray<O>,
  shift: RetimeShift
): Array<{ readonly id: string; readonly at: number }> =>
  overlays.flatMap((overlay) => {
    const at = clampOverlayAnchor(overlay.at, shift);
    return at === overlay.at ? [] : [{ id: overlay.id, at }];
  });
