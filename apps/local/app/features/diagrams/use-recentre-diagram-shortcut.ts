import { useEffect } from "react";
import { isTextEntryTarget, type ShortcutTarget } from "./snapshot-navigation";

/**
 * NOT Cmd/Ctrl+0. That reads as the common "reset view" convention, but it's
 * also Chrome/Firefox/Safari's own "reset zoom level to 100%" shortcut,
 * reserved at the browser-chrome level — `preventDefault()` on the keydown
 * event cannot stop it (unlike, say, Cmd/Ctrl+F, which this route also
 * rebinds and which the browser lets a page override). A handler bound to it
 * simply never runs; the browser changes its own zoom instead, and the
 * camera — which was never touched — looks like it "ignored" the tuned
 * padding, when really it was never asked to move at all.
 *
 * Cmd/Ctrl+Home keeps the "back to the start" convention without landing on
 * a combo the browser owns. Free in tldraw's own keymap (which binds
 * `shift+0`/`shift+1`/`shift+2` for zoom, never Home) and in this route's
 * other shortcuts (Cmd/Ctrl+S/K/F/[/]).
 */
export function isRecentreShortcut(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  key: string;
}): boolean {
  return (e.ctrlKey || e.metaKey) && e.key === "Home";
}

/**
 * Snap the camera back to the tuned, face-cam-aware centred position on
 * demand — separate from the automatic recentre on scene load/switch, for
 * whenever the author has panned or zoomed around while working and wants to
 * get back before hitting record.
 */
export function useRecentreDiagramShortcut(onRecentre: (() => void) | null) {
  useEffect(() => {
    if (!onRecentre) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextEntryTarget(e.target as ShortcutTarget | null)) return;
      if (isRecentreShortcut(e)) {
        e.preventDefault();
        onRecentre();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onRecentre]);
}
