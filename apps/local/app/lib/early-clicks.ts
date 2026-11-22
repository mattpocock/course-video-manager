import { after } from "@/packages/clock";

/**
 * Clicks that land before React hydrates.
 *
 * The server-rendered page paints its buttons 0.3–1.1s before React has
 * attached a single listener (the video editor is the slowest). A click
 * inside that window reaches no handler at all, and React never replays it:
 * the "first click after a page load is swallowed" bug.
 *
 * `captureEarlyClicks` runs as an inline `<script>` in the document head
 * (root.tsx), before the body is parsed. Until hydration commits it owns
 * every click whose default action the browser would not already have
 * performed: it buffers it and stops it there, so React (whose listeners may
 * already be attached but whose tree is not yet live) never half-handles it.
 * `replayEarlyClicks` runs from root Layout's effect, after hydration has
 * committed: it stops buffering and, a task later, dispatches the first
 * buffered click again — the full pointer/mouse sequence, so `onPointerDown`
 * triggers (Radix menus, selects) fire as well as `onClick` ones.
 *
 * Only the first: clicks after it are the user retrying a page that looked
 * dead, and replayed back to back in one task they would all get past a
 * button's own disable-while-busy guard — two clicks on "Post", two posts.
 */

type EarlyClick = {
  target: Element;
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

type EarlyClickBuffer = {
  clicks: EarlyClick[];
  listener: (event: MouseEvent) => void;
};

declare global {
  interface Window {
    __cvmEarlyClicks?: EarlyClickBuffer;
  }
}

/**
 * Inlined into the page as source text (`captureEarlyClicks.toString()`), so
 * it must stay self-contained: no imports, no closure over module scope.
 */
export function captureEarlyClicks(): void {
  if (window.__cvmEarlyClicks) return;
  const clicks: EarlyClick[] = [];
  const listener = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || event.defaultPrevented) return;
    // The browser already acted on these without JavaScript: a link
    // navigated, a field focused or toggled. Replaying would act twice.
    if (
      target.closest(
        "a[href], input, select, textarea, label, summary, [contenteditable]"
      )
    ) {
      return;
    }
    const button = target.closest("button");
    if (button && button.type === "submit" && button.form) return;
    event.stopImmediatePropagation();
    clicks.push({
      target,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    });
  };
  window.__cvmEarlyClicks = { clicks, listener };
  document.addEventListener("click", listener, true);
}

export const captureEarlyClicksScript = `(${captureEarlyClicks.toString()})();`;

export function replayEarlyClicks(): void {
  const buffer = window.__cvmEarlyClicks;
  if (!buffer) return;
  document.removeEventListener("click", buffer.listener, true);
  delete window.__cvmEarlyClicks;
  // A task later, not now: hydration's own layout effects can queue a sync
  // re-render (the course page's runs for seconds in dev), and a click
  // dispatched from inside the commit would be rendered on top of it. A task
  // later it lands where a real click would, once the thread is free.
  const [first] = buffer.clicks;
  if (first) after(0, () => dispatchClick(first));
}

function dispatchClick(click: EarlyClick): void {
  // Hydration replaced the element (a mismatch re-rendered it): drop the
  // click rather than hand it to whatever now sits at its coordinates.
  if (!click.target.isConnected) return;
  const target = click.target;
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: click.clientX,
    clientY: click.clientY,
    ctrlKey: click.ctrlKey,
    metaKey: click.metaKey,
    shiftKey: click.shiftKey,
    altKey: click.altKey,
    button: 0,
    view: window,
  };
  const pointer = {
    ...init,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
  };
  target.dispatchEvent(
    new PointerEvent("pointerdown", { ...pointer, buttons: 1 })
  );
  target.dispatchEvent(
    new MouseEvent("mousedown", { ...init, buttons: 1, detail: 1 })
  );
  target.dispatchEvent(new PointerEvent("pointerup", pointer));
  target.dispatchEvent(new MouseEvent("mouseup", { ...init, detail: 1 }));
  target.dispatchEvent(new MouseEvent("click", { ...init, detail: 1 }));
}
