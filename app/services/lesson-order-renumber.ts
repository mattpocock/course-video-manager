/**
 * Pure renumbering logic used by the filesystem resync (`api.courses.update`)
 * to keep `lesson.order` collision-free while respecting both disk truth and
 * interleaved ghost lessons.
 *
 * Background: resync re-derives each *real* lesson's `order` from the numeric
 * prefix of its on-disk path (its `lessonNumber`). Ghost lessons have no path
 * number, so they never participate in that pass — and a ghost that the user
 * dragged between two real lessons (which sits on a shifted integer slot) ends
 * up colliding with the real lesson whose slot resync re-claims. Because the
 * read queries order by `order` with no tie-breaker, the tied pair then
 * flickers between page loads.
 *
 * The fix is to renumber each section densely after resync. We sort by the
 * post-resync `order` (disk truth for reals), and break the freshly-created
 * real/ghost ties using the *pre-resync* order — which still encodes where the
 * ghost was relative to its neighbours — so the ghost lands back in its slot.
 */

export interface LessonForRenumber {
  id: string;
  order: number;
  fsStatus: string;
}

/**
 * Given a section's lessons (in their post-resync state) and a map of each
 * lesson's order *before* resync mutated anything, returns the dense
 * `0..n-1` order assignment that preserves display order and eliminates
 * collisions. Newly-added lessons (absent from `preOrderById`) fall back to
 * their current order, then `id`, as tie-breakers.
 */
export const computeDenseLessonOrders = (
  lessons: readonly LessonForRenumber[],
  preOrderById: ReadonlyMap<string, number>
): { id: string; order: number }[] => {
  const sorted = [...lessons].sort((a, b) => {
    // Primary: post-resync order — disk truth for real lessons.
    if (a.order !== b.order) return a.order - b.order;
    // Secondary: pre-resync order — recovers the ghost's intended position
    // when resync has just dropped a real lesson onto the ghost's slot.
    const preA = preOrderById.get(a.id) ?? a.order;
    const preB = preOrderById.get(b.id) ?? b.order;
    if (preA !== preB) return preA - preB;
    // Final: stable, deterministic.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted.map((lesson, index) => ({ id: lesson.id, order: index }));
};
