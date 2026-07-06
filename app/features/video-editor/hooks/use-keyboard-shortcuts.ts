import { useEffect } from "react";
import type { videoStateReducer } from "../video-state-reducer";

/**
 * Hook that handles keyboard shortcuts for the video editor.
 *
 * Listens for keyboard events and dispatches appropriate actions:
 * - Space: Toggle recording/playback
 * - Delete: Delete selected clips
 * - Enter: Confirm/submit action
 * - Arrow keys: Navigate and move clips
 * - Alt+Arrow Up/Down: Move clips in timeline
 * - l: Mark clip start
 * - k: Mark clip end
 * - Home/End: Navigate to first/last clip
 * - b/B: Toggle pause between clips
 * - F2: Rename selected section (handled in VideoEditor component)
 *
 * Ignores keyboard events when focus is on input fields, textareas,
 * or buttons (unless they have the "allow-keydown" class).
 */
export function useKeyboardShortcuts(
  dispatch: (action: videoStateReducer.Action) => void
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLButtonElement &&
          !e.target.classList.contains("allow-keydown"))
      ) {
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        if (e.repeat) return;
        dispatch({ type: "press-space-bar" });
      } else if (e.key === "Delete") {
        dispatch({ type: "press-delete" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        dispatch({ type: "press-return" });
      } else if (e.key === "ArrowLeft") {
        dispatch({ type: "press-arrow-left" });
      } else if (e.key === "ArrowRight") {
        dispatch({ type: "press-arrow-right" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (e.altKey) {
          dispatch({ type: "press-alt-arrow-up" });
        } else {
          dispatch({ type: "press-arrow-up" });
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (e.altKey) {
          dispatch({ type: "press-alt-arrow-down" });
        } else {
          dispatch({ type: "press-arrow-down" });
        }
      } else if (e.key === "l") {
        dispatch({ type: "press-l" });
      } else if (e.key === "k") {
        dispatch({ type: "press-k" });
      } else if (e.key === "Home") {
        dispatch({ type: "press-home" });
      } else if (e.key === "End") {
        dispatch({ type: "press-end" });
      } else if (e.key === "b" || e.key === "B") {
        dispatch({ type: "pause-toggle-key-pressed" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dispatch]);
}
