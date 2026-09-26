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
 * here is that timeline's, lifted: same "all or nothing" toggle. See
 * `features/video-editor/components/clip-timeline.tsx`.
 *
 * A FOLD IS ONLY EVER OPENED BY HAND. The playhead does not open one — it plays
 * straight through a folded Chapter, and the divider's fill bar is what says so
 * (`animatic-progress.ts`). Both surfaces used to spring the Chapter open at the
 * boundary, which undid the author's fold every few seconds on exactly the
 * settled Playthrough he folded away to stop looking at.
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
 * The row indices a folded Chapter has taken off the screen.
 *
 * A HIDDEN ROW IS NEVER SELECTED. The sidebar draws a folded Chapter's rows
 * nowhere, so the arrow keys must not walk them either: a selection on a row
 * that is not on screen has nothing to scroll into sight, and RETURN then plays
 * a Clip Mockup the author never saw highlighted. `moveSelection` and
 * `selectEdge` in `animatic-selection.ts` take this set and step over it.
 *
 * Indices are the timeline's own — the `index` on each row — so the set can be
 * read straight against a selection. It is empty while nothing is folded away,
 * which is what keeps a Video with no Chapters exactly as it was.
 */
export function hiddenRowIndices(params: {
  readonly collapsed: AnimaticCollapseState;
  readonly sections: readonly AnimaticChapterSection[];
}): ReadonlySet<number> {
  const hidden = new Set<number>();
  for (const section of params.sections) {
    if (!params.collapsed[section.chapter.id]) continue;
    for (const row of section.rows) hidden.add(row.index);
  }
  return hidden;
}

