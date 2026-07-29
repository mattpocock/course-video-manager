/**
 * 2-D arrow-key arithmetic over a grid of cmdk items.
 *
 * Pure and index-based on purpose: the DOM-order reading stays in the hook
 * (`use-grid-nav.ts`) because cmdk REORDERS items in the DOM by match score
 * while filtering, but the arithmetic does not need a DOM to be right.
 */

export type GridKey =
  "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

/**
 * The next index for a key press, or `"fall-through"` when the key belongs to
 * cmdk rather than to the grid.
 */
export function nextGridIndex(opts: {
  current: number;
  count: number;
  columns: number;
  key: GridKey;
}): number | "fall-through" {
  const { current, count, columns, key } = opts;
  if (count === 0) return "fall-through";

  const last = count - 1;
  const i = Math.min(Math.max(current, 0), last);

  switch (key) {
    case "ArrowRight":
      return Math.min(i + 1, last);
    case "ArrowLeft":
      return Math.max(i - 1, 0);
    case "ArrowDown":
      // On the last row, fall to the final cell rather than doing nothing, so
      // holding Down always terminates somewhere sensible.
      return i + columns <= last ? i + columns : last;
    case "ArrowUp":
      // Row 0 deliberately falls through to cmdk, which returns focus to the
      // input — Up out of the top of a grid is how you get back to typing.
      if (i < columns) return "fall-through";
      return i - columns;
    case "Home":
      return 0;
    case "End":
      return last;
  }
}
