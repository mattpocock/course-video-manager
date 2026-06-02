import { useState, useCallback } from "react";

const COLLAPSED_SECTIONS_KEY = "collapsed-sections";

function persistToLocalStorage(next: Set<string>) {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...next]));
    } catch {}
  }
}

export function useCollapsedSections() {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => {
      if (typeof localStorage === "undefined") return new Set();
      try {
        const stored = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
        if (stored) return new Set(JSON.parse(stored) as string[]);
      } catch {}
      return new Set();
    }
  );

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      persistToLocalStorage(next);
      return next;
    });
  }, []);

  const expandAll = useCallback((sectionIds: string[]) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      for (const id of sectionIds) {
        next.delete(id);
      }
      persistToLocalStorage(next);
      return next;
    });
  }, []);

  const collapseAll = useCallback((sectionIds: string[]) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      for (const id of sectionIds) {
        next.add(id);
      }
      persistToLocalStorage(next);
      return next;
    });
  }, []);

  return { collapsedSections, toggleSection, expandAll, collapseAll };
}
