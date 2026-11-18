/** What a key in the face slider does; null leaves it to the slider. */
export type FaceSliderCommand =
  | { command: "undo" }
  | { command: "redo" }
  | { command: "nudge"; direction: -1 | 1; big: boolean };

type SliderKey = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
};

/**
 * The face slider's keys. Cmd/Ctrl+Z (Shift for redo) is the editor's one
 * history, which the face is on too. While the editor counts as focused,
 * tldraw's own shortcut (on <body>, below React's root on the document) has
 * already run it and prevented the default: then the slider leaves it, or
 * the step would be undone twice. ←/→ nudge the face, Shift for bigger steps.
 */
export function faceSliderKeyCommand(e: SliderKey): FaceSliderCommand | null {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    if (e.defaultPrevented) return null;
    return { command: e.shiftKey ? "redo" : "undo" };
  }
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return null;
  return {
    command: "nudge",
    direction: e.key === "ArrowLeft" ? -1 : 1,
    big: e.shiftKey,
  };
}
