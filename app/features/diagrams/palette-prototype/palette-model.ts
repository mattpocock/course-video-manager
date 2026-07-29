// PROTOTYPE — throwaway. Answers wayfinder issue #209 (palette IA + grid keyboard nav).
// Not production code: no tests, no error handling, stub component library.

import { icons } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type PageKey =
  "root" | "icons" | "diagrams" | "components" | "nameComponent";

export type RootAction = {
  id: string;
  label: string;
  hint: string;
  group: string;
  icon: keyof typeof icons;
  /** Pushes a nested page rather than firing immediately. */
  opens?: PageKey;
  /** Hidden when the tldraw selection is empty. */
  requiresSelection?: boolean;
};

/**
 * The v1 action list, locked on the map (decision 14 + issue #209).
 * `group` and array order are what the three variants disagree about — each
 * variant re-sorts/re-groups this same list.
 */
export const ROOT_ACTIONS: RootAction[] = [
  {
    id: "insert-icon",
    label: "Insert icon",
    hint: "Browse 1,611 lucide icons",
    group: "Insert",
    icon: "Shapes",
    opens: "icons",
  },
  {
    id: "go-to-diagram",
    label: "Go to diagram",
    hint: "Search names and contents",
    group: "Navigate",
    icon: "Search",
    opens: "diagrams",
  },
  {
    id: "insert-component",
    label: "Insert component",
    hint: "Reusable saved selections",
    group: "Insert",
    icon: "Blocks",
    opens: "components",
  },
  {
    id: "save-component",
    label: "Save selection as component",
    hint: "Name the current selection",
    group: "Insert",
    icon: "BookmarkPlus",
    opens: "nameComponent",
    requiresSelection: true,
  },
  {
    id: "preserve-snapshot",
    label: "Preserve current as snapshot",
    hint: "Pin this state to the timeline",
    group: "Snapshot",
    icon: "Save",
  },
  {
    id: "restore-head",
    label: "Restore to head",
    hint: "Discard changes since last snapshot",
    group: "Snapshot",
    icon: "History",
  },
  {
    id: "copy-contents",
    label: "Copy diagram contents",
    hint: "Copy every shape to the clipboard",
    group: "Diagram",
    icon: "Copy",
  },
  {
    id: "rename-diagram",
    label: "Rename diagram",
    hint: "Set a new name",
    group: "Diagram",
    icon: "PenLine",
  },
  {
    id: "new-diagram",
    label: "New diagram",
    hint: "Create and switch to a blank diagram",
    group: "Diagram",
    icon: "Plus",
  },
];

export const ACTIONS_BY_ID = new Map(ROOT_ACTIONS.map((a) => [a.id, a]));

export function getIcon(name: keyof typeof icons): LucideIcon {
  return icons[name];
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

/** PascalCase lucide names, e.g. "ArrowLeftRight". 1,611 of them. */
export const ICON_NAMES = Object.keys(icons) as (keyof typeof icons)[];

/** "ArrowLeftRight" -> "arrow left right", the string users actually type. */
function toWords(pascal: string): string {
  return pascal
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase();
}

export const ICON_INDEX: { name: keyof typeof icons; words: string }[] =
  ICON_NAMES.map((name) => ({ name, words: toWords(name) }));

/**
 * Manual icon filter. Prefix-match on any word, then whole-string substring —
 * cheap enough to run over 1,611 entries on every keystroke.
 */
export function filterIcons(query: string, cap: number) {
  const q = query.trim().toLowerCase();
  if (!q) return ICON_INDEX.slice(0, cap);
  const starts: typeof ICON_INDEX = [];
  const contains: typeof ICON_INDEX = [];
  for (const entry of ICON_INDEX) {
    if (entry.words.startsWith(q)) starts.push(entry);
    else if (entry.words.includes(q)) contains.push(entry);
    if (starts.length >= cap) break;
  }
  return [...starts, ...contains].slice(0, cap);
}

// ---------------------------------------------------------------------------
// Components — stubbed. There is no component table yet (map decision 7).
// ---------------------------------------------------------------------------

export type StubComponent = {
  id: string;
  name: string;
  shapeCount: number;
  /** Fake thumbnail so grid density is judged against real pixels. */
  thumbnail: string;
};

const COMPONENT_SEEDS: [string, number, string, string][] = [
  ["Request/response pair", 6, "#38bdf8", "rect-arrow-rect"],
  ["Three-tier stack", 9, "#a78bfa", "stack"],
  ["Event bus fan-out", 12, "#f472b6", "fanout"],
  ["Client / server split", 5, "#34d399", "split"],
  ["Retry loop", 7, "#fbbf24", "loop"],
  ["Database cylinder + label", 3, "#60a5fa", "cylinder"],
  ["Happy path / error path", 8, "#f87171", "fork"],
  ["Queue with workers", 11, "#c084fc", "queue"],
  ["Before / after columns", 4, "#2dd4bf", "columns"],
  ["Callout box (warning)", 2, "#fb923c", "callout"],
  ["Timeline with 4 beats", 10, "#a3e635", "timeline"],
  ["Boundary crossing", 6, "#22d3ee", "boundary"],
  ["Cache read-through", 8, "#e879f9", "cache"],
  ["Numbered step badges", 5, "#94a3b8", "badges"],
];

function makeThumb(color: string, kind: string): string {
  const shapes: Record<string, string> = {
    "rect-arrow-rect": `<rect x="6" y="20" width="22" height="16" rx="3"/><rect x="52" y="20" width="22" height="16" rx="3"/><path d="M30 28h20M46 24l4 4-4 4" fill="none" stroke-width="2"/>`,
    stack: `<rect x="18" y="8" width="44" height="12" rx="2"/><rect x="18" y="24" width="44" height="12" rx="2"/><rect x="18" y="40" width="44" height="12" rx="2"/>`,
    fanout: `<circle cx="16" cy="28" r="7"/><circle cx="62" cy="12" r="5"/><circle cx="62" cy="28" r="5"/><circle cx="62" cy="44" r="5"/><path d="M23 28h32M23 28L57 13M23 28l34 15" fill="none" stroke-width="1.5"/>`,
    split: `<rect x="6" y="12" width="28" height="32" rx="3"/><rect x="46" y="12" width="28" height="32" rx="3"/><path d="M40 8v40" fill="none" stroke-width="1.5" stroke-dasharray="3 3"/>`,
    loop: `<rect x="24" y="18" width="32" height="20" rx="3"/><path d="M24 28h-10v16h52V28h-10" fill="none" stroke-width="2"/>`,
    cylinder: `<ellipse cx="40" cy="14" rx="18" ry="6"/><path d="M22 14v28c0 3 8 6 18 6s18-3 18-6V14" fill="none" stroke-width="2"/>`,
    fork: `<circle cx="14" cy="28" r="6"/><rect x="46" y="6" width="26" height="14" rx="3"/><rect x="46" y="36" width="26" height="14" rx="3"/><path d="M20 28h14l12-15M34 28l12 15" fill="none" stroke-width="1.5"/>`,
    queue: `<rect x="8" y="20" width="10" height="16" rx="2"/><rect x="20" y="20" width="10" height="16" rx="2"/><rect x="32" y="20" width="10" height="16" rx="2"/><circle cx="58" cy="18" r="6"/><circle cx="58" cy="38" r="6"/>`,
    columns: `<rect x="8" y="8" width="28" height="40" rx="3"/><rect x="44" y="8" width="28" height="40" rx="3"/>`,
    callout: `<path d="M10 10h60v28H30l-10 10V38H10z" stroke-width="2"/>`,
    timeline: `<path d="M6 28h68" fill="none" stroke-width="2"/><circle cx="14" cy="28" r="5"/><circle cx="32" cy="28" r="5"/><circle cx="50" cy="28" r="5"/><circle cx="68" cy="28" r="5"/>`,
    boundary: `<rect x="4" y="10" width="30" height="34" rx="3"/><rect x="46" y="10" width="30" height="34" rx="3"/><path d="M40 4v48" stroke-width="2" stroke-dasharray="4 4"/><path d="M28 27h24" stroke-width="2"/>`,
    cache: `<rect x="6" y="18" width="20" height="20" rx="3"/><rect x="54" y="18" width="20" height="18" rx="3"/><rect x="30" y="20" width="20" height="16" rx="8"/>`,
    badges: `<circle cx="16" cy="28" r="9"/><circle cx="38" cy="28" r="9"/><circle cx="60" cy="28" r="9"/>`,
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 56" fill="none" stroke="${color}" stroke-width="2"><g>${shapes[kind] ?? shapes.stack}</g></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const STUB_COMPONENTS: StubComponent[] = COMPONENT_SEEDS.map(
  ([name, shapeCount, color, kind], i) => ({
    id: `c${i}`,
    name,
    shapeCount,
    thumbnail: makeThumb(color, kind),
  })
);
