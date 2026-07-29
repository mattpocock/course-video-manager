// PROTOTYPE — throwaway. The core thing issue #209 has to prove.
//
// cmdk's Command root renders:
//   onKeyDown: (e) => { props.onKeyDown?.(e); if (!e.defaultPrevented) { ...its own nav... } }
// so a handler passed as `onKeyDown` to <Command> runs FIRST and can suppress
// cmdk's built-in 1-D navigation entirely with e.preventDefault(). No capture
// phase, no stopPropagation, no patching. Verified against cmdk 1.1.1 source.

import { useCallback, type KeyboardEvent, type RefObject } from "react";

const ITEM_SELECTOR = '[cmdk-item=""]:not([aria-disabled="true"])';

type GridNavOptions = {
  /** Element containing the grid cells — normally the CommandList. */
  listRef: RefObject<HTMLElement | null>;
  /** Fixed column count. Must match the CSS grid-template-columns. */
  columns: number;
  /** Currently selected cmdk value (the controlled `value` on <Command>). */
  value: string;
  onValueChange: (next: string) => void;
  /** Off on list pages — there cmdk's own 1-D nav is exactly right. */
  enabled: boolean;
};

/**
 * 2-D arrow navigation over cmdk items laid out as a grid.
 *
 * Reads live DOM order rather than the source array, because cmdk *reorders*
 * items in the DOM by match score while filtering (see `z()` in its source).
 * DOM order is therefore the only reliable source of visual order.
 */
export function useGridNav({
  listRef,
  columns,
  value,
  onValueChange,
  enabled,
}: GridNavOptions) {
  return useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!enabled) return;
      const { key } = e;
      if (
        key !== "ArrowLeft" &&
        key !== "ArrowRight" &&
        key !== "ArrowUp" &&
        key !== "ArrowDown" &&
        key !== "Home" &&
        key !== "End"
      ) {
        return;
      }

      const root = listRef.current;
      if (!root) return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)
      );
      if (items.length === 0) return;

      const current = items.findIndex(
        (el) => el.getAttribute("data-value") === value
      );
      const i = current < 0 ? 0 : current;
      const last = items.length - 1;

      let next = i;
      if (key === "ArrowRight") next = Math.min(i + 1, last);
      else if (key === "ArrowLeft") next = Math.max(i - 1, 0);
      else if (key === "ArrowDown") {
        // Last row: fall to the final cell rather than doing nothing, so
        // holding Down always terminates somewhere sensible.
        next = i + columns <= last ? i + columns : last;
      } else if (key === "ArrowUp") {
        // First row: Up is the natural way back to the input. Let it through
        // by returning early so the caller can decide (variants differ).
        if (i < columns) return;
        next = i - columns;
      } else if (key === "Home") next = 0;
      else if (key === "End") next = last;

      // Suppress cmdk's 1-D handler for every key we own.
      e.preventDefault();

      const el = items[next];
      const nextValue = el?.getAttribute("data-value");
      if (!el || !nextValue) return;
      onValueChange(nextValue);
      // cmdk only auto-scrolls when IT changes the value; a controlled value
      // set from outside skips its scroll effect, so do it here.
      el.scrollIntoView({ block: "nearest" });
    },
    [enabled, columns, value, onValueChange, listRef]
  );
}
