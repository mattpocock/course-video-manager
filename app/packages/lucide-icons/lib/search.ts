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

export function buildSearchIndex(names: readonly string[]): IconSearchEntry[] {
  const aliasesByTarget = new Map<string, string[]>();
  for (const [alias, target] of Object.entries(SYNONYMS)) {
    const list = aliasesByTarget.get(target);
    if (list) list.push(alias);
    else aliasesByTarget.set(target, [alias]);
  }

  return names.map((name) => ({
    name,
    terms: [toWords(name), ...(aliasesByTarget.get(name) ?? []).map(toWords)],
  }));
}

const NO_MATCH = -1;
const EXACT = 0;
const PREFIX = 1;
const SUBSTRING = 2;

/** How well `q` matches an entry, on the scale above. */
function matchTier(entry: IconSearchEntry, q: string): number {
  // An empty query matches everything, and nothing about it is exact.
  if (!q) return PREFIX;
  if (entry.terms.some((t) => t === q)) return EXACT;
  if (entry.terms.some((t) => t.startsWith(q))) return PREFIX;
  if (entry.terms.some((t) => t.includes(q))) return SUBSTRING;
  return NO_MATCH;
}

/**
 * Ranked in four bands: an exact term match, then anything in `recent`, then
 * prefix matches, then whole-string substring ones — cheap enough to run over
 * the whole table on every keystroke.
 *
 * `recent` (a most-recently-used list, most recent first) outranks textual
 * quality because the alphabetical table order it would otherwise fall back to
 * carries no information at all. It does NOT outrank an exact match: Enter fires
 * on the first cell, so a name the author has spelled out in full has to stay
 * there or history would insert the wrong icon. Names the build has never heard
 * of are ignored, so a stored list can outlive the table it was written against.
 *
 * The `limit` is about MOUNT COST, not filter quality: rendering all ~1,775
 * icon cells and letting cmdk filter them costs ~0.7s of dead air on every
 * open, while filtering here and capping costs ~0.17s for an identical top-8.
 */
export function searchIndex(
  index: readonly IconSearchEntry[],
  query: string,
  limit: number,
  recent: readonly string[] = []
): string[] {
  const q = query.trim().toLowerCase();

  const rankByName = new Map(recent.map((name, i) => [name, i]));
  const exact: string[] = [];
  // Sparse on purpose: written by rank, so recency order survives a table that
  // visits the names in some entirely unrelated order.
  const recentHits: string[] = [];
  let recentFound = 0;
  const starts: string[] = [];
  const contains: string[] = [];

  for (const entry of index) {
    const tier = matchTier(entry, q);
    if (tier === NO_MATCH) continue;

    const rank = rankByName.get(entry.name);
    if (tier === EXACT) exact.push(entry.name);
    else if (rank !== undefined) recentHits[rank] = entry.name;
    else if (tier === PREFIX) starts.push(entry.name);
    else contains.push(entry.name);

    if (rank !== undefined) recentFound++;

    // A cheap guard, not a rule: it must not fire while a recent icon could
    // still be waiting further down the table, or the cap would silently swallow
    // the one ordering the author explicitly earned.
    if (
      exact.length + starts.length >= limit &&
      recentFound === rankByName.size
    ) {
      break;
    }
  }

  return [
    ...exact,
    ...recentHits.filter((name) => name !== undefined),
    ...starts,
    ...contains,
  ].slice(0, limit);
}

export { SYNONYMS };
