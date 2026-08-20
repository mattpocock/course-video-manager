import { useEffect } from "react";
import { isTextEntryTarget, type ShortcutTarget } from "./snapshot-navigation";

/**
 * Cmd/Ctrl+0 — the common "reset view" convention (browsers, maps apps).
 * Free in tldraw's own keymap (which binds `shift+0`/`shift+1`/`shift+2` for
 * zoom, never a bare 0) and in this route's other shortcuts
 * (Cmd/Ctrl+S/K/F/[/]).
 *
 * Turned out NOT to be a dead binding — swapping it for Cmd/Ctrl+Home
 * changed nothing, which ruled out the browser's reserved "reset zoom"
 * shortcut as the cause of "recentre doesn't respect the padding I've
 * chosen". The actual bug was in `centreCameraOnContent`'s fit math (it
 * capped zoom at 100%, so a small diagram never reached the padding edges
 * regardless of which key triggered the recentre) — see its history. This
 * stays on the conventional key.
 */
export function isRecentreShortcut(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  key: string;
}): boolean {
  return (e.ctrlKey || e.metaKey) && e.key === "0";
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
