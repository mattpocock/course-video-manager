import { useCallback, useMemo } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import * as collapsedIds from "./collapsed-ids";

/**
 * Collapse state that outlives the page: which ids are folded away, kept in
 * `localStorage` under `storageKey` so reopening a course (or bouncing through
 * a video and back) restores the shape you left the page in.
 *
 * The set algebra lives in {@link collapsedIds} and the persistence in
 * {@link useLocalStorage}; this only stitches the two together, storing the set
 * as a JSON array of ids. Callers: the course grid's sections and the section
 * page's Scripts tab.
 */
export function useCollapsedIds(storageKey: string) {
  const [stored, setStored] = useLocalStorage(storageKey, "[]");

  const collapsed = useMemo(
    () => collapsedIds.parseCollapsedIds(stored),
    [stored]
  );

  const update = useCallback(
    (next: (previous: collapsedIds.CollapsedIds) => Set<string>) => {
      setStored((previous) =>
        JSON.stringify([...next(collapsedIds.parseCollapsedIds(previous))])
      );
    },
    [setStored]
  );

  const toggle = useCallback(
    (id: string) => update((previous) => collapsedIds.toggleId(previous, id)),
    [update]
  );

  /** Labels the {@link toggleAll} control: true means it should read "Expand all". */
  const areAllCollapsed = useCallback(
    (ids: readonly string[]) => collapsedIds.areAllCollapsed(collapsed, ids),
    [collapsed]
  );

  /** Collapse-all / expand-all in one control: folds unless everything is folded. */
  const toggleAll = useCallback(
    (ids: readonly string[]) =>
      update((previous) =>
        collapsedIds.areAllCollapsed(previous, ids)
          ? collapsedIds.expandIds(previous, ids)
          : collapsedIds.collapseIds(previous, ids)
      ),
    [update]
  );

  return { collapsed, toggle, areAllCollapsed, toggleAll };
}
