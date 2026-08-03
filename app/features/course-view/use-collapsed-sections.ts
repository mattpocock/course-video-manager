import { useCollapsedIds } from "./use-collapsed-ids";

const COLLAPSED_SECTIONS_KEY = "collapsed-sections";

/** Which sections of the course grid are folded away, remembered per browser. */
export function useCollapsedSections() {
  const { collapsed, toggle, expandAll, collapseAll } = useCollapsedIds(
    COLLAPSED_SECTIONS_KEY
  );

  return {
    collapsedSections: collapsed,
    toggleSection: toggle,
    expandAll,
    collapseAll,
  };
}
