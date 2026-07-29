import type { PageKey } from "./palette-nav";

export type PaletteGroup = "Insert" | "Navigate" | "Snapshot" | "Diagram";

export type RootAction = {
  id: string;
  label: string;
  hint: string;
  group: PaletteGroup;
  /** A lucide name, rendered through the vendored table's React counterpart. */
  icon: string;
  /** Pushes a nested page rather than firing immediately. */
  opens?: PageKey;
  /** Absent — not disabled — when the tldraw selection is empty. */
  requiresSelection?: boolean;
};

/**
 * The v1 action list, grouped rather than flat-and-frequency-ordered: the
 * grouped root list IS the discovery surface, because ADR 0004 rules out any
 * persistent on-canvas hint pointing at Cmd+K.
 *
 * The Snapshot and Diagram groups MIRROR the surrounding chrome — each is wired
 * to the handler the existing UI already calls, so there is no second
 * implementation of any of them and the right-rail timeline is untouched.
 */
export const ROOT_ACTIONS: RootAction[] = [
  {
    id: "insert-icon",
    label: "Insert icon",
    hint: "Browse the lucide icon set",
    group: "Insert",
    icon: "shapes",
    opens: "icons",
  },
  {
    id: "insert-component",
    label: "Insert component",
    hint: "Reusable saved selections",
    group: "Insert",
    icon: "blocks",
    opens: "components",
  },
  {
    id: "save-component",
    label: "Save selection as component",
    hint: "Name the current selection",
    group: "Insert",
    icon: "bookmark-plus",
    opens: "nameComponent",
    // Absent rather than greyed out: the list stays short and everything in it
    // is actionable.
    requiresSelection: true,
  },
  {
    id: "go-to-diagram",
    label: "Go to diagram",
    hint: "Search names and contents",
    group: "Navigate",
    icon: "search",
    opens: "diagrams",
  },
  {
    id: "preserve-snapshot",
    label: "Preserve current as snapshot",
    hint: "Pin this state to the timeline",
    group: "Snapshot",
    icon: "save",
  },
  {
    id: "restore-head",
    label: "Restore to head",
    hint: "Reload the last saved state",
    group: "Snapshot",
    // lucide renamed `history` to `rotate-ccw-clock`; the frozen table carries
    // the canonical name, and the old one survives only as a search synonym.
    icon: "rotate-ccw-clock",
  },
  {
    id: "copy-contents",
    label: "Copy diagram contents",
    hint: "Copy every shape to the clipboard",
    group: "Diagram",
    icon: "copy",
  },
  {
    id: "rename-diagram",
    label: "Rename diagram",
    hint: "Set a new name",
    group: "Diagram",
    icon: "pen-line",
    opens: "renameDiagram",
  },
  {
    id: "new-diagram",
    label: "New diagram",
    hint: "Create and switch to a blank diagram",
    group: "Diagram",
    icon: "plus",
  },
];

/** Root rows render in this order, under these headings. */
export const GROUP_ORDER: PaletteGroup[] = [
  "Insert",
  "Navigate",
  "Snapshot",
  "Diagram",
];

export const ACTIONS_BY_ID = new Map(ROOT_ACTIONS.map((a) => [a.id, a]));

/** Grid pages, and the fixed column count each one's CSS lays out. */
export const GRID_COLUMNS: Partial<Record<PageKey, number>> = {
  icons: 10,
  components: 4,
  diagrams: 3,
};

export const PAGE_TITLES: Record<PageKey, string> = {
  root: "Command palette",
  icons: "Insert icon",
  components: "Insert component",
  diagrams: "Go to diagram",
  nameComponent: "Save selection as component",
  renameComponent: "Rename component",
  renameDiagram: "Rename diagram",
};

/**
 * Icons are filtered client-side and CAPPED. This is about mount cost, not
 * filter quality: mounting all ~1,775 icon cells and letting cmdk filter takes
 * ~737ms to paint, while a manual filter capped at 200 takes ~172ms with an
 * identical top-8.
 */
export const ICON_RESULT_CAP = 200;

/**
 * Plain case-insensitive SUBSTRING matching for component names.
 *
 * cmdk's default filter is `command-score`, a fuzzy subsequence matcher: it
 * returns most of a small library for "rt" and matches "queue" against
 * "Request/response pair". Without this override the grid feels broken.
 */
export function matchesComponentName(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return name.toLowerCase().includes(q);
}
