/**
 * The palette's global keyboard shortcuts, as a pure decision function.
 *
 * Extracted from the hook for the same reason the page stack is (see
 * `palette-nav`): a plain function is the only part of this the test suite can
 * reach. The open/closed state comes in as an argument rather than being
 * branched on in the hook, so "which key dismisses and which never does" is
 * decided here, where it is tested.
 */

import type { PageKey } from "./palette-nav";

export type PaletteCommand =
  /** Summon it, standing on `page` — or on the root list when that is null. */
  { command: "open"; page: PageKey | null } | { command: "close" };

/** What the palette reads off a keydown — nothing React-specific. */
type ShortcutEvent = { key: string; metaKey: boolean; ctrlKey: boolean };

/**
 * tldraw 5.2.4 leaves both of these unbound with a modifier held (the laser and
 * frame tools bind bare `k` and `f`, and their modifier matching is exact) and
 * never stopPropagations keydown, so a plain document listener is enough — and
 * it works identically in Focus Mode.
 *
 * Cmd/Ctrl+F takes the browser's binding: find-in-page can find nothing on a
 * canvas of shapes, and searching Diagram contents is the thing an author
 * actually meant by it.
 */
export function paletteKeyCommand(
  e: ShortcutEvent,
  palette: { isOpen: boolean }
): PaletteCommand | null {
  if (!e.metaKey && !e.ctrlKey) return null;
  switch (e.key.toLowerCase()) {
    case "k":
      // The summon key is the dismiss key too.
      return palette.isOpen
        ? { command: "close" }
        : { command: "open", page: null };

    case "f":
      // Never a toggle. Pressed with the palette already up — sitting on the
      // root, or on whatever page the author has since walked to — it goes to
      // the search rather than dismissing the thing just asked for.
      return { command: "open", page: "diagrams" };

    default:
      return null;
  }
}
