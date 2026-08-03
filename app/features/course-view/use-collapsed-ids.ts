import { useCallback, useState } from "react";
import {
  areAllCollapsed,
  collapseIds,
  expandIds,
  toggleId,
  type CollapsedIds,
} from "./collapsed-ids";

/**
 * Collapse state that outlives the page: which ids are folded away, kept in
 * `localStorage` under `storageKey` so reopening a course (or bouncing through
 * a video and back) restores the shape you left the page in.
 *
 * The set algebra lives in {@link collapsed-ids}; this only adds React state
 * and persistence. Callers: {@link useCollapsedSections} for the course grid's
 * sections, and the section page's Scripts tab for individual scripts.
 */
export function useCollapsedIds(storageKey: string) {
  const [collapsed, setCollapsed] = useState<CollapsedIds>(() =>
    readStoredIds(storageKey)
  );

  const update = useCallback(
    (next: (previous: CollapsedIds) => Set<string>) => {
      setCollapsed((previous) => {
        const value = next(previous);
        persistIds(storageKey, value);
        return value;
      });
    },
    [storageKey]
  );

  const toggle = useCallback(
    (id: string) => update((previous) => toggleId(previous, id)),
    [update]
  );

  const expandAll = useCallback(
    (ids: readonly string[]) => update((previous) => expandIds(previous, ids)),
    [update]
  );

  const collapseAll = useCallback(
    (ids: readonly string[]) =>
      update((previous) => collapseIds(previous, ids)),
    [update]
  );

  /** Collapse-all / expand-all in one control: folds unless everything is folded. */
  const toggleAll = useCallback(
    (ids: readonly string[]) =>
      update((previous) =>
        areAllCollapsed(previous, ids)
          ? expandIds(previous, ids)
          : collapseIds(previous, ids)
      ),
    [update]
  );

  return { collapsed, toggle, expandAll, collapseAll, toggleAll };
}

function readStoredIds(storageKey: string): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) return new Set(JSON.parse(stored) as string[]);
  } catch {}
  return new Set();
}

function persistIds(storageKey: string, ids: CollapsedIds) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey, JSON.stringify([...ids]));
  } catch {}
}
