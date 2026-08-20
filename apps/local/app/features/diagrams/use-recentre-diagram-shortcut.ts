import { useEffect } from "react";
import { isTextEntryTarget, type ShortcutTarget } from "./snapshot-navigation";

function isRecentreShortcut(e: {
  ctrlKey: boolean;
  metaKey: boolean;
  key: string;
}): boolean {
  // Cmd/Ctrl+0 — the common "reset view" convention (browsers, maps apps).
  // Free in both tldraw's own keymap and this route's other shortcuts
  // (Cmd/Ctrl+S/K/F/[/]).
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
