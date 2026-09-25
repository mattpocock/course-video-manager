import type { AnimaticChapterSection } from "./animatic-chapters";

/**
 * Which Clip Mockup Chapters are folded away in the Animatic's sidebar.
 *
 * COLLAPSING IS WHY CHAPTERS EXIST. A settled Playthrough is twenty rows the
 * author has finished judging; folding them puts the two moments he is still
 * judging next to each other on screen.
 *
 * The state is EPHEMERAL and it is the player's own: a plain record keyed by
 * Chapter id, born empty on every load. A collapse is a five-second-old
 * intention, not a setting, so nothing is written down and nothing is shared.
 * The Video Editor's Clip timeline makes the same choice, and the arithmetic
 * here is that timeline's, lifted: same "all or nothing" toggle, same
 * auto-expand on the playhead. See
 * `features/video-editor/components/clip-timeline.tsx`.
 *
 * It hides ROWS, never frames. Nothing here can touch the clock: the run time
 * and the `14 / 61` position badge read the same open or closed.
 */
export type AnimaticCollapseState = Readonly<Record<string, boolean>>;

/**
 * Is every Chapter folded away? A Video with no Chapter is never "all
 * collapsed", which is what keeps the collapse-all control off that page.
 */
export function areAllChaptersCollapsed(
  collapsed: AnimaticCollapseState,
  chapterIds: readonly string[]
): boolean {
  return chapterIds.length > 0 && chapterIds.every((id) => collapsed[id]);
}

/** Fold one Chapter away, or open it, and leave every other one as it was. */
export function toggleChapter(
  collapsed: AnimaticCollapseState,
  chapterId: string
): AnimaticCollapseState {
  return { ...collapsed, [chapterId]: !collapsed[chapterId] };
}

/**
 * One control for the lot: it folds every Chapter away while any is open, and
 * opens every Chapter once all are closed.
 */
export function toggleAllChapters(
  collapsed: AnimaticCollapseState,
  chapterIds: readonly string[]
): AnimaticCollapseState {
  const collapse = !areAllChaptersCollapsed(collapsed, chapterIds);
  const next = { ...collapsed };
  for (const id of chapterIds) next[id] = collapse;
  return next;
}

/**
 * Open the Chapter the playhead has entered.
 *
 * THE LIST NEVER HIDES THE ROW BEING HEARD. The author folded a Chapter away
 * while it was somebody else's problem; the moment the Animatic plays into it,
 * it is his again.
 *
 * It returns the SAME state when nothing changed, so the effect that calls it
 * on every segment boundary asks React for no re-render.
 */
export function expandChapterAtPlayhead(params: {
  readonly collapsed: AnimaticCollapseState;
  readonly sections: readonly AnimaticChapterSection[];
  /** The playing row's index in the timeline, or a negative number for none. */
  readonly activeIndex: number;
}): AnimaticCollapseState {
  if (params.activeIndex < 0) return params.collapsed;
  const playing = params.sections.find((section) =>
    section.rows.some((row) => row.index === params.activeIndex)
  );
  if (!playing || !params.collapsed[playing.chapter.id])
    return params.collapsed;
  return { ...params.collapsed, [playing.chapter.id]: false };
}
