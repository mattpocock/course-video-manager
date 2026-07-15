// Live observable for browser (Chrome) focus state. The Chrome link-capture
// extension emits `browser-focus` events via the WebSocket hub; this module
// exposes them as a simple boolean + subscribe API, mirroring
// `diagram-focus-tracking.ts`. The recording session panel uses it to show
// "URL focused" when Chrome is in the foreground.

let focused = false;
const listeners = new Set<(focused: boolean) => void>();

export function notifyBrowserFocus(): void {
  if (focused) return;
  focused = true;
  for (const listener of listeners) listener(true);
}

export function notifyBrowserBlur(): void {
  if (!focused) return;
  focused = false;
  for (const listener of listeners) listener(false);
}

export function isBrowserFocused(): boolean {
  return focused;
}

export function subscribeBrowserFocus(
  listener: (focused: boolean) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
