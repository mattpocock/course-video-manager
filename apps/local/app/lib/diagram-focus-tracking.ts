// Live observable for diagram-window focus state. The diagram playground
// posts `focus` / `blur` messages and this module exposes them as a simple
// boolean + subscribe API. Snapshot timing is decided elsewhere (the speech
// detector locks in focus at the silence-detected transition).

let focused = false;
const listeners = new Set<(focused: boolean) => void>();

export function notifyDiagramFocus(): void {
  if (focused) return;
  focused = true;
  for (const listener of listeners) listener(true);
}

export function notifyDiagramBlur(): void {
  if (!focused) return;
  focused = false;
  for (const listener of listeners) listener(false);
}

export function isDiagramFocused(): boolean {
  return focused;
}

export function subscribeDiagramFocus(
  listener: (focused: boolean) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
