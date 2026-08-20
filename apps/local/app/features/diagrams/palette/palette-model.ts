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
  /**
   * What the tldraw selection has to be for this row to exist at all. A row
   * whose requirement is unmet is ABSENT, never greyed out.
   */
  requires?: keyof PaletteSelection;
};

/** What the palette knows about the canvas selection when it opens. */
export type PaletteSelection = {
  hasSelection: boolean;
  /** Exactly one shape is selected and it is a `cvm-icon`. */
  hasSingleIcon: boolean;
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
    id: "replace-icon",
    label: "Replace icon",
    hint: "Swap the selected icon, keeping its size and position",
    group: "Insert",
    icon: "replace",
    opens: "replaceIcon",
    // Only for a lone icon: two icons, or an icon plus something else, has no
    // unambiguous target.
    requires: "hasSingleIcon",
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
    requires: "hasSelection",
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
    id: "recentre-diagram",
    label: "Recentre diagram",
    hint: "Snap the camera back to the tuned, face-cam-aware centre (Cmd/Ctrl+Home)",
    group: "Navigate",
    icon: "crosshair",
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

/**
 * Rows the root list shows right now.
 *
 * Actions that make no sense are ABSENT rather than greyed out, so the list
 * stays short and everything in it is actionable.
 */
export function visibleRootActions(selection: PaletteSelection) {
  return ROOT_ACTIONS.filter((a) => !a.requires || selection[a.requires]);
}

/**
 * Everything that varies per page, in one table.
 *
 * `columns` is present only on the grid pages, and its value is the fixed
 * column count that page's CSS lays out — there is no `ResizeObserver`, because
 * the palette is a fixed width.
 */
export const PAGE_META: Record<
  PageKey,
  { title: string; placeholder: string; columns?: number }
> = {
  root: { title: "Command palette", placeholder: "Type a command…" },
  icons: { title: "Insert icon", placeholder: "Search…", columns: 10 },
  // The same grid as `icons`, and deliberately a separate page rather than a
  // mode flag on that one: the page IS what Enter means here, so a stale flag
  // could not silently insert a second icon next to the one being replaced.
  replaceIcon: { title: "Replace icon", placeholder: "Search…", columns: 10 },
  components: {
    title: "Insert component",
    placeholder: "Search…",
    columns: 4,
  },
  diagrams: { title: "Go to diagram", placeholder: "Search…", columns: 3 },
  nameComponent: {
    title: "Save selection as component",
    placeholder: "Name this component…",
  },
  renameComponent: {
    title: "Rename component",
    placeholder: "New name for this component…",
  },
  renameDiagram: {
    title: "Rename diagram",
    placeholder: "New name for this diagram…",
  },
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
