/**
 * The pure set algebra behind every "fold this away" control in the course
 * view: collapse state is a set of the ids that are folded, so anything not in
 * the set is open (the default for ids the user has never touched — a fresh
 * lesson or video shows its content rather than hiding it).
 *
 * Kept free of React and `localStorage` so it can be unit-tested directly;
 * {@link useCollapsedIds} layers persistence on top, and both the course grid's
 * sections and the section page's Scripts tab build on that.
 */

export type CollapsedIds = ReadonlySet<string>;

/** Folds `id` away if it is open, opens it if it is folded. */
export function toggleId(collapsed: CollapsedIds, id: string): Set<string> {
  const next = new Set(collapsed);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** Folds every given id away, leaving already-folded ones alone. */
export function collapseIds(
  collapsed: CollapsedIds,
  ids: readonly string[]
): Set<string> {
  const next = new Set(collapsed);
  for (const id of ids) next.add(id);
  return next;
}

/** Opens every given id, leaving ids outside the list folded. */
export function expandIds(
  collapsed: CollapsedIds,
  ids: readonly string[]
): Set<string> {
  const next = new Set(collapsed);
  for (const id of ids) next.delete(id);
  return next;
}

/**
 * Whether a toggle-all control should read "Expand all". Empty means nothing is
 * folded — an empty list is "expanded", so the control never offers a no-op.
 */
export function areAllCollapsed(
  collapsed: CollapsedIds,
  ids: readonly string[]
): boolean {
  return ids.length > 0 && ids.every((id) => collapsed.has(id));
}

/**
 * Reads back what {@link useCollapsedIds} persisted. `localStorage` is shared
 * with every other tab and every past version of this app, so the stored JSON
 * is untrusted input: anything that isn't an array of strings means "nothing is
 * folded" rather than a crash or a set of stray characters (`new Set("abc")`
 * would otherwise fold three single-letter ids).
 */
export function parseCollapsedIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}
