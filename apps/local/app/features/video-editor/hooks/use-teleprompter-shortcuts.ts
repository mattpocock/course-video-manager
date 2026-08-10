/**
 * Teleprompter transport controls that work from the *editor* window.
 *
 * Only `P` (play/pause). The popup's other shortcuts — J/K for nudging, R for
 * reset — would collide with the editor's own timeline keys, and pausing is the
 * one you reach for mid-take anyway: you're standing at the camera, the crawl
 * has run ahead, and the editor window is what your hand is on.
 */
import { useEffect } from "react";
import { sendTeleprompterCommand } from "@/lib/teleprompter-window";
import { shouldIgnoreKeyboardShortcut } from "./should-ignore-keyboard-shortcut";

export function useTeleprompterShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldIgnoreKeyboardShortcut(e)) return;
      if (e.key !== "p" && e.key !== "P") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      sendTeleprompterCommand("togglePlay");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
