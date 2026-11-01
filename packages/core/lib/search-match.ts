/**
 * The one matching rule every search in the app shares: `cvm search`, Global
 * Search and the in-page list filters.
 *
 * A value matches when it contains the query as a literal, case-insensitive
 * substring (no tokenising, regex or fuzzy). The query's ends are trimmed. An
 * empty query matches every value, so a list with an empty search box shows
 * everything; the shared search refuses an empty query before it matches
 * anything, so it returns nothing.
 */
export const matchesSearchQuery = (
  value: string | null | undefined,
  query: string
): boolean => {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return typeof value === "string" && value.toLowerCase().includes(q);
};
