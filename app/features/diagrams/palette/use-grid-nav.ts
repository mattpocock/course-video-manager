import { useCallback, type KeyboardEvent, type RefObject } from "react";
import { nextGridIndex, type GridKey } from "./grid-nav";

/**
 * 2-D arrow navigation over cmdk items laid out as a grid.
 *
 * cmdk's Command root renders:
 *   onKeyDown: (e) => { props.onKeyDown?.(e); if (!e.defaultPrevented) { …its own 1-D nav… } }
 * so a handler passed as `onKeyDown` to `<Command>` runs FIRST and can suppress
 * the built-in list navigation entirely with `preventDefault()`. No fork, no
 * capture phase, no patching.
 */

const ITEM_SELECTOR = '[cmdk-item=""]:not([aria-disabled="true"])';

const GRID_KEYS = new Set<string>([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

export function useGridNav(opts: {
  /** Element containing the grid cells — normally the CommandList. */
  listRef: RefObject<HTMLElement | null>;
  /** Fixed column count. Must match the CSS grid-template-columns. */
  columns: number;
  /** The controlled cmdk `value`. */
  value: string;
  onValueChange: (next: string) => void;
  /** Off on list pages, where cmdk's own 1-D nav is exactly right. */
  enabled: boolean;
}) {
  const { listRef, columns, value, onValueChange, enabled } = opts;

  return useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!enabled || !GRID_KEYS.has(e.key)) return;

      const root = listRef.current;
      if (!root) return;

      // LIVE DOM ORDER, never the source array: cmdk reorders items in the DOM
      // by match score while filtering, so the array order and the visual order
      // diverge the moment anything is typed.
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)
      );
      if (items.length === 0) return;

      const current = items.findIndex(
        (el) => el.getAttribute("data-value") === value
      );

      const next = nextGridIndex({
        current,
        count: items.length,
        columns,
        key: e.key as GridKey,
      });
      // ArrowUp on row 0 belongs to cmdk, which returns focus to the input.
      if (next === "fall-through") return;

      // Suppress cmdk's 1-D handler for every key we own.
      e.preventDefault();

      const el = items[next];
      const nextValue = el?.getAttribute("data-value");
      if (!el || !nextValue) return;
      onValueChange(nextValue);
      // cmdk only auto-scrolls when IT changes the value; a controlled value set
      // from outside skips its scroll effect, so do it here.
      el.scrollIntoView({ block: "nearest" });
    },
    [enabled, columns, value, onValueChange, listRef]
  );
}
