/**
 * The instant of its Footage a B-roll shows `elapsed` seconds into its
 * window: `from + elapsed`. On screen is the latest Footage frame AT OR
 * BEFORE that instant — what a `<video>` sought there shows.
 *
 * The one rule the editor's preview (`bRollFootageTimeAt`) and the export
 * (`buildOverlayCompositeArgs`) both read, so they show the same frame even
 * when `from` is off the Footage's frame grid: the export seeks to
 * `bRollFootageTime(from, 0)` without dropping the frame before it, rather
 * than starting on the first frame after it.
 */
export const bRollFootageTime = (from: number, elapsed: number): number =>
  from + elapsed;
