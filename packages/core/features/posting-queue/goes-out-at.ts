import { formatLondon } from "../time/london-time.js";

/**
 * A Posting Slot as people read it: the ISO `slot`, with its UK wall-clock
 * reading (`goesOutAt`, "Tue 2026-11-03 13:00") beside it. `cvm short post`,
 * `cvm short queue`, the Shorts page modal and its Queue panel all print a
 * slot through this, so they never read one differently.
 */
export const withGoesOutAt = <T extends { readonly slot: string | null }>(
  row: T
): T & { readonly goesOutAt: string | null } => ({
  ...row,
  goesOutAt: row.slot === null ? null : formatLondon(Date.parse(row.slot)),
});

/**
 * The Posting Queue as `cvm short queue` prints it and the Queue panel
 * shows it: the listing, every entry with its UK time.
 */
export const postingQueueView = <
  E extends { readonly slot: string | null },
>(listing: {
  readonly days: number;
  readonly entries: ReadonlyArray<E>;
}) => ({
  days: listing.days,
  entries: listing.entries.map(withGoesOutAt),
});
