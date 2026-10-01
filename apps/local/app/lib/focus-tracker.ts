/**
 * A live boolean for "is that other window in front right now?", plus a
 * subscribe API. Each feature that tracks focus makes its own tracker with
 * {@link createFocusTracker}; the two below are the ones the recording session
 * panel reads. Snapshot timing is decided elsewhere (the speech detector locks
 * in focus at the silence-detected transition).
 */
export interface FocusTracker {
  isFocused(): boolean;
  /** Mark focused. Tells subscribers only when the value changes. */
  focus(): void;
  /** Mark unfocused. Tells subscribers only when the value changes. */
  blur(): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: (focused: boolean) => void): () => void;
}

export function createFocusTracker(): FocusTracker {
  let focused = false;
  const listeners = new Set<(focused: boolean) => void>();

  const set = (next: boolean) => {
    if (focused === next) return;
    focused = next;
    for (const listener of listeners) listener(next);
  };

  return {
    isFocused: () => focused,
    focus: () => set(true),
    blur: () => set(false),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Diagram playground focus. The playground posts `focus` / `blur` messages and
 * `enableVideoEditorMode` in `diagram-window.ts` feeds them in here.
 */
export const diagramFocus = createFocusTracker();

/**
 * Browser (Chrome) focus. The Chrome link-capture extension emits
 * `browser-focus` events via the WebSocket hub, and the video edit route feeds
 * them in here. The recording session panel shows "URL focused" from it.
 */
export const browserFocus = createFocusTracker();
