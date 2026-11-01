/** What the shortcut reads off a keydown: nothing React-specific. */
type ShortcutEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/**
 * Whether a keydown is Global Search's key: Ctrl+K, or Cmd+K on a Mac. The
 * same key opens and closes it (the reducer decides which). It is taken even
 * from inside an input or the dialog itself, so it always closes what it
 * opened. Prior art: the Diagram palette's `paletteKeyCommand`, which keeps
 * the key in the Diagram Playground, where Global Search is not mounted.
 */
export function isGlobalSearchShortcut(e: ShortcutEvent): boolean {
  return (
    (e.metaKey || e.ctrlKey) &&
    !e.altKey &&
    !e.shiftKey &&
    e.key.toLowerCase() === "k"
  );
}
