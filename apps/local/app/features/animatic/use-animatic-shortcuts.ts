import { useEffect, useRef } from "react";
import { shouldIgnoreKeyboardShortcut } from "@/hooks/should-ignore-keyboard-shortcut";

/**
 * The Animatic's keys, and they are the VIDEO PAGE'S KEYS.
 *
 * The author moves between the two screens all day. A key that means "play the
 * thing I have selected" on one of them cannot mean nothing, or something else,
 * on the other — so every shortcut here is lifted from
 * `features/video-editor/hooks/use-keyboard-shortcuts.ts` and given the
 * Animatic's own equivalent of the same action. Only the keys that have such an
 * equivalent are here: the Animatic is read-only, so DELETE, ALT+ARROW (reorder)
 * and B (pause marker) have nothing to act on.
 *
 * The same guard as the Video page decides when a key is not ours
 * (`shouldIgnoreKeyboardShortcut`), so typing in a field or a dialog never
 * plays the Animatic.
 */

export interface AnimaticShortcutHandlers {
  /** SPACE — play/pause where the playhead already is. Selection untouched. */
  onTogglePlay: () => void;
  /** RETURN — play the selected Clip Mockup from its own start. */
  onPlaySelected: () => void;
  /** ARROW UP / LEFT and ARROW DOWN / RIGHT — move the selection only. */
  onMoveSelection: (delta: number) => void;
  /** HOME / END — select the first / last Clip Mockup. */
  onSelectEdge: (edge: "first" | "last") => void;
  /** L and K — 2x and 1x, the Video page's transport keys. */
  onChooseRate: (rate: number) => void;
  /** C — subtitles on or off, as on YouTube. The Animatic's own key. */
  onToggleSubtitles: () => void;
}

export function useAnimaticShortcuts(handlers: AnimaticShortcutHandlers) {
  // The handlers close over playback state that changes on every segment, so
  // they are read through a ref: the listener is installed once and never
  // re-installed, which is what stops a re-render dropping a keypress.
  const held = useRef(handlers);
  held.current = handlers;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreKeyboardShortcut(e)) return;

      if (e.key === " ") {
        e.preventDefault();
        if (e.repeat) return;
        held.current.onTogglePlay();
      } else if (e.key === "Enter") {
        e.preventDefault();
        held.current.onPlaySelected();
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        held.current.onMoveSelection(-1);
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        held.current.onMoveSelection(1);
      } else if (e.key === "Home") {
        held.current.onSelectEdge("first");
      } else if (e.key === "End") {
        held.current.onSelectEdge("last");
      } else if (e.key === "l") {
        held.current.onChooseRate(2);
      } else if (e.key === "k") {
        held.current.onChooseRate(1);
      } else if (e.key === "c") {
        held.current.onToggleSubtitles();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
