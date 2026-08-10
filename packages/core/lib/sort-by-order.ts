/**
 * Compare two order strings using ASCII/byte ordering.
 * This matches PostgreSQL's COLLATE "C" behavior.
 *
 * IMPORTANT: Do NOT use localeCompare() for order strings.
 * localeCompare() uses locale-aware sorting which differs from COLLATE "C".
 * The fractional-indexing library generates keys like "Zz" to sort before "a0",
 * which requires byte ordering (where 'Z' (90) < 'a' (97)).
 */
export const compareOrderStrings = (a: string, b: string): number => {
  return a < b ? -1 : a > b ? 1 : 0;
};

/**
 * Sort an array of items by their `order` string property using ASCII/byte ordering.
 * Returns a new sorted array (does not mutate the input).
 *
 * @see {@link compareOrderStrings} for why this uses byte ordering instead of localeCompare.
 */
export const sortByOrder = <T extends { order: string }>(items: T[]): T[] => {
  return [...items].sort((a, b) => compareOrderStrings(a.order, b.order));
};
