/**
 * Pure renumbering logic to keep `lesson.order` collision-free after bulk
 * reordering. Renumbers each section densely (0..n-1) while preserving
 * display order.
 */

export interface LessonForRenumber {
  id: string;
  order: number;
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
    // Secondary: pre-resync order — recovers the dragged lesson's intended position
    // when resync has just dropped a lesson onto the dragged lesson's slot.
    const preA = preOrderById.get(a.id) ?? a.order;
    const preB = preOrderById.get(b.id) ?? b.order;
    if (preA !== preB) return preA - preB;
    // Final: stable, deterministic.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return sorted.map((lesson, index) => ({ id: lesson.id, order: index }));
};
