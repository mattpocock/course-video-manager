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

/**
 * Prefix-match on any term first, then whole-string substring — cheap enough to
 * run over the whole table on every keystroke.
 *
 * The `limit` is about MOUNT COST, not filter quality: rendering all ~1,775
 * icon cells and letting cmdk filter them costs ~0.7s of dead air on every
 * open, while filtering here and capping costs ~0.17s for an identical top-8.
 */
export function searchIndex(
  index: readonly IconSearchEntry[],
  query: string,
  limit: number
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.slice(0, limit).map((e) => e.name);

  const starts: string[] = [];
  const contains: string[] = [];

  for (const entry of index) {
    if (entry.terms.some((t) => t.startsWith(q))) starts.push(entry.name);
    else if (entry.terms.some((t) => t.includes(q))) contains.push(entry.name);
    if (starts.length >= limit) break;
  }

  return [...starts, ...contains].slice(0, limit);
}

export { SYNONYMS };
