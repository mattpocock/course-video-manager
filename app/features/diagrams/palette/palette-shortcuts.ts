/**
 * The palette's global keyboard shortcuts, as a pure matcher.
 *
 * Extracted from the hook for the same reason the page stack is (see
 * `palette-nav`): a plain function is the only part of this the test suite can
 * reach.
 */

import type { PageKey } from "./palette-nav";

export type PaletteShortcut =
  /** Summon or dismiss, whichever the palette is not already doing. */
  | { action: "toggle" }
  /** Summon it already standing on a page, skipping the root list. */
  | { action: "openAt"; page: PageKey };

/** What the palette reads off a keydown — nothing React-specific. */
type ShortcutEvent = { key: string; metaKey: boolean; ctrlKey: boolean };

/**
 * tldraw 5.2.4 leaves both of these unbound with a modifier held (the laser and
 * frame tools bind bare `k` and `f`, and their modifier matching is exact) and
 * never stopPropagations keydown, so a plain document listener is enough — and
 * it works identically in Focus Mode.
 *
 * Both take the browser's binding: Cmd/Ctrl+F is find-in-page, which on a
 * canvas of shapes can find nothing, and searching diagram contents is the
 * thing an author actually meant by it.
 */
export function matchPaletteShortcut(e: ShortcutEvent): PaletteShortcut | null {
  if (!e.metaKey && !e.ctrlKey) return null;
  switch (e.key.toLowerCase()) {
    case "k":
      return { action: "toggle" };
    case "f":
      return { action: "openAt", page: "diagrams" };
    default:
      return null;
  }
}
