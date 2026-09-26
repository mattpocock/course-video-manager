import type { AnimaticChapterSection } from "./animatic-chapters";
import type { AnimaticSegment } from "./animatic-timeline";

/**
 * How far through the thing on screen the playhead is — the bar that fills.
 *
 * THE ANIMATIC WAS TOO QUIET ABOUT WHAT WAS PLAYING. A highlighted row says
 * "this one", and nothing says how much of it is left; the Video Editor's Clip
 * timeline has answered that for years with a bar that fills across the row
 * being played (`components/clip-item.tsx`). This is that bar's arithmetic,
 * lifted, and it is arithmetic only: no React, no Remotion, no DOM.
 *
 * IT IS WRITTEN TO CSS, NOT TO STATE. A fill is a per-frame number and this
 * page deliberately holds only the SEGMENT in state — see the `activeIndex`
 * comment in `animatic-player.tsx`, which exists because a frame in state
 * re-rendered a polling page thirty times a second. So the player writes these
 * two numbers onto a custom property on the sidebar and the bars are sized in
 * CSS from it: the fill moves every frame while React renders once per Clip
 * Mockup.
 */

/** The fill of the Clip Mockup being played. Read by the playing row's bar. */
export const MOCKUP_PROGRESS_VAR = "--animatic-mockup-progress";

/**
 * The fill of the Chapter being played. Read by a FOLDED Chapter's divider,
 * which is the only thing on screen for the rows inside it.
 */
export const CHAPTER_PROGRESS_VAR = "--animatic-chapter-progress";

/** `0` before the span starts, `1` after it ends, and the fraction inside it. */
function fractionThrough(params: {
  readonly frame: number;
  readonly startFrame: number;
  readonly durationInFrames: number;
}): number {
  if (params.durationInFrames <= 0) return 0;
  const through = (params.frame - params.startFrame) / params.durationInFrames;
  return Math.min(1, Math.max(0, through));
}

/**
 * How far through its own hold the Clip Mockup under the playhead is.
 *
 * Measured across the WHOLE segment, speech and the gap after it, because that
 * is exactly how long the frame is held on screen — a bar that finished at the
 * end of the speech would sit full through every gap.
 */
export function mockupProgressAtFrame(params: {
  readonly segments: readonly AnimaticSegment[];
  readonly activeIndex: number;
  readonly frame: number;
}): number {
  const segment = params.segments[params.activeIndex];
  if (!segment) return 0;
  return fractionThrough({
    frame: params.frame,
    startFrame: segment.startFrame,
    durationInFrames: segment.durationInFrames,
  });
}

/**
 * How far through a Chapter the playhead is.
 *
 * A Chapter's rows are contiguous on the timeline, so its span is the first
 * row's start and the sum of every row's frames — the same frames its run time
 * is read off. An empty Chapter has no span and never fills.
 */
export function chapterProgressAtFrame(params: {
  readonly section: AnimaticChapterSection;
  readonly frame: number;
}): number {
  const first = params.section.rows[0];
  if (!first) return 0;
  const durationInFrames = params.section.rows.reduce(
    (total, row) => total + row.segment.durationInFrames,
    0
  );
  return fractionThrough({
    frame: params.frame,
    startFrame: first.segment.startFrame,
    durationInFrames,
  });
}

/**
 * The Chapter the playing row sits under, or `undefined` while the playhead is
 * above the first divider — those rows belong to no Chapter.
 */
export function sectionAtIndex(params: {
  readonly sections: readonly AnimaticChapterSection[];
  readonly activeIndex: number;
}): AnimaticChapterSection | undefined {
  if (params.activeIndex < 0) return undefined;
  return params.sections.find((section) =>
    section.rows.some((row) => row.index === params.activeIndex)
  );
}

/**
 * The CSS a bar is sized with. Unitless var times a percentage, so the fill is
 * a share of whatever row or divider it is drawn inside, and it is `0` until
 * the player has written a frame.
 */
export function progressFillStyle(variable: string): { readonly width: string } {
  return { width: `calc(var(${variable}, 0) * 100%)` };
}
