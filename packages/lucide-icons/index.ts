// Entry point (public) — the DATA half of the lucide-icons package.
//
// Deliberately tldraw-free: `extract-scene-text` and the rest of the server
// path resolve icon names through here, and must not pull tldraw into the
// server bundle. Geometry-to-tldraw conversion lives behind the separate
// `./tldraw` entry point.
//
// The table under `lib/generated` is COMMITTED, APPEND-ONLY data — see
// `./generator` for the invariant and `scripts/generate-lucide-icons.ts` for
// how it is produced. It is not a view over `node_modules`: a Diagram stores an
// icon *name*, and the geometry behind a name must never change.

import iconNodesJson from "./lib/generated/icon-nodes.json";
import { buildSearchIndex, searchIndex } from "./lib/search";
import type { IconNode } from "./generator";

export type { IconNode, IconPrimitive } from "./generator";

const ICONS = iconNodesJson as unknown as Record<string, IconNode>;

/** Every canonical lucide name in the frozen table, sorted. */
export const ICON_NAMES: readonly string[] = Object.keys(ICONS).sort();

/**
 * The raw lucide geometry for a name, or `undefined` if this build has never
 * heard of it. Callers must tolerate `undefined` rather than throw: an unknown
 * name has to survive a document load and round-trip untouched, so that one bad
 * name costs a placeholder rather than the whole diagram.
 */
export function getIconNode(name: string): IconNode | undefined {
  return Object.prototype.hasOwnProperty.call(ICONS, name)
    ? ICONS[name]
    : undefined;
}

const INDEX = buildSearchIndex(ICON_NAMES);

/**
 * Search icon names, honouring lucide's own aliases as synonyms — typing
 * "grab" finds `hand-grab`. Returns at most `limit` names, best matches first.
 *
 * `recent` is the caller's most-recently-used list, most recent first. Whichever
 * of those names match are sorted to the TOP — ahead of every textual ranking
 * except a term typed out in full, which always leads. Unknown names are
 * ignored. It is REQUIRED, and `[]` says "no history": a caller that could omit
 * it would drop the recency ordering silently rather than fail to compile.
 */
export function searchIconNames(
  query: string,
  opts: { limit?: number; recent: readonly string[] }
): string[] {
  return searchIndex(INDEX, query, opts.limit ?? 200, opts.recent);
}
