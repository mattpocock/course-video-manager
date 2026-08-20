import { generateNKeysBetween } from "fractional-indexing";

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

/**
 * The fractional `order` key for a new-or-moved timeline item that should land
 * immediately BEFORE `beforeItemId` in `items` — an already merged-and-sorted
 * clip+chapter timeline (with the item being MOVED, if any, already filtered
 * out by the caller). `beforeItemId === null` means "append to the end".
 *
 * Returns `null` (and only then) when `beforeItemId` is given but not present in
 * `items`, so the caller can raise its own noun-specific NotFoundError — a
 * successful placement always yields a non-null key. This is the single
 * positioning primitive shared by `createClip`/`moveClipToPosition` and
 * `createChapterAtItem`/`moveChapterToPosition`, which otherwise repeated it
 * verbatim and could drift apart.
 */
export const orderKeyBeforeItem = (
  items: readonly { readonly id: string; readonly order: string }[],
  beforeItemId: string | null
): string | null => {
  let prevOrder: string | null;
  let nextOrder: string | null;
  if (beforeItemId === null) {
    prevOrder = items.at(-1)?.order ?? null;
    nextOrder = null;
  } else {
    const idx = items.findIndex((item) => item.id === beforeItemId);
    if (idx === -1) return null;
    prevOrder = items[idx - 1]?.order ?? null;
    nextOrder = items[idx]!.order;
  }
  const [order] = generateNKeysBetween(prevOrder, nextOrder, 1);
  return order!;
};
