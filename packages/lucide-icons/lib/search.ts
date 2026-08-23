// Internal. Reach it through `../index`.
//
// Name search over the frozen table. Synonyms widen what a query MATCHES; they
// never rewrite a stored name, so this file carries no persistence contract and
// its map is free to be regenerated wholesale.

import synonymsJson from "./generated/synonyms.json";

const SYNONYMS = synonymsJson as Record<string, string>;

/** "git-branch" -> "git branch", the string a person actually types. */
function toWords(kebab: string): string {
  return kebab.replace(/-/g, " ").toLowerCase();
}

export type IconSearchEntry = {
  name: string;
  /** The name plus every alias that resolves to it, all as space-separated words. */
  terms: string[];
};

export type IconSearchIndex = {
  /** Table order, which is the fallback ranking. */
  entries: IconSearchEntry[];
  /** So a recently-used name resolves by lookup instead of by scanning. */
  byName: Map<string, IconSearchEntry>;
};

export function buildSearchIndex(names: readonly string[]): IconSearchIndex {
  const aliasesByTarget = new Map<string, string[]>();
  for (const [alias, target] of Object.entries(SYNONYMS)) {
    const list = aliasesByTarget.get(target);
    if (list) list.push(alias);
    else aliasesByTarget.set(target, [alias]);
  }

  const entries = names.map((name) => ({
    name,
    terms: [toWords(name), ...(aliasesByTarget.get(name) ?? []).map(toWords)],
  }));

  return { entries, byName: new Map(entries.map((e) => [e.name, e])) };
}

/** How well a query matches an entry; `null` is no match at all. */
type MatchTier = "exact" | "prefix" | "substring" | null;

function matchTier(entry: IconSearchEntry, q: string): MatchTier {
  // An empty query matches everything, and nothing about it is exact.
  if (!q) return "prefix";
  if (entry.terms.some((t) => t === q)) return "exact";
  if (entry.terms.some((t) => t.startsWith(q))) return "prefix";
  if (entry.terms.some((t) => t.includes(q))) return "substring";
  return null;
}

/**
 * Ranked in four bands: an exact term match, then anything in `recent`, then
 * prefix matches, then whole-string substring ones — cheap enough to run over
 * the whole table on every keystroke.
 *
 * `recent` (a most-recently-used list, most recent first) outranks textual
 * quality because the alphabetical table order it would otherwise fall back to
 * carries no information at all. It does NOT outrank an exact match: Enter fires
 * on the first cell, so a term the author has spelled out in full — a name, or
 * one of lucide's aliases — has to stay there or history would insert the wrong
 * icon. Names the build has never heard of are ignored, so a stored list can
 * outlive the table it was written against.
 *
 * The `limit` is about MOUNT COST, not filter quality: rendering all ~1,775
 * icon cells and letting cmdk filter them costs ~0.7s of dead air on every
 * open, while filtering here and capping costs ~0.17s for an identical top-8.
 */
export function searchIndex(
  index: IconSearchIndex,
  query: string,
  limit: number,
  recent: readonly string[]
): string[] {
  const q = query.trim().toLowerCase();

  const exact: string[] = [];
  const recentHits: string[] = [];
  // Resolved by lookup, ahead of the scan and in recency order. Doing it here
  // rather than inside the scan is what lets the `limit` guard below stop early:
  // a recent name sitting at the far end of the table is already accounted for.
  const promoted = new Set<string>();
  for (const name of recent) {
    if (promoted.has(name)) continue;
    const entry = index.byName.get(name);
    if (!entry) continue;
    const tier = matchTier(entry, q);
    if (tier === null) continue;
    promoted.add(name);
    if (tier === "exact") exact.push(name);
    else recentHits.push(name);
  }

  const starts: string[] = [];
  const contains: string[] = [];
  for (const entry of index.entries) {
    if (promoted.has(entry.name)) continue;
    const tier = matchTier(entry, q);
    if (tier === "exact") exact.push(entry.name);
    else if (tier === "prefix") starts.push(entry.name);
    else if (tier === "substring") contains.push(entry.name);
    // `contains` is excluded on purpose: it is the band a later prefix match
    // displaces, so it can never be what fills the last cell.
    if (exact.length + recentHits.length + starts.length >= limit) break;
  }

  return [...exact, ...recentHits, ...starts, ...contains].slice(0, limit);
}

export { SYNONYMS };
