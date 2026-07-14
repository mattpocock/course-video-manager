// Live singleton that records the browser link-capture event stream and, on
// demand, computes the set of web pages that were on screen during a clip.
//
// The Chrome extension broadcasts `browser-focus` / `browser-url` events over
// the forwarder hub; `use-browser-link-capture.ts` feeds them here. The Video
// Editor opens a "clip window" when speech is detected (an optimistic clip is
// added) and drains it when the clip's audio window closes — mirroring how the
// diagram feature locks in focus state at the silence-detected transition.
//
// All timing/side-effects live here; the actual interval maths is the pure
// `computeClipWebLinks` in `clip-web-link-timeline.ts`.

import {
  computeClipWebLinks,
  type BrowserLinkEvent,
  type CapturedWebLink,
} from "./clip-web-link-timeline";

// Keep a few minutes of events so a clip's seed state (the last URL/focus event
// before the clip opened) is always available. Clips are seconds long.
const LOG_RETENTION_MS = 5 * 60 * 1000;

// Upper bound on a clip window if `openClipWindow` was somehow missed, so a
// stale open timestamp can never pull in minutes of unrelated browsing.
const MAX_WINDOW_MS = 2 * 60 * 1000;

let eventLog: BrowserLinkEvent[] = [];
let openedAt: number | null = null;

function prune(now: number): void {
  const cutoff = now - LOG_RETENTION_MS;
  if (eventLog.length > 0 && eventLog[0]!.ts < cutoff) {
    eventLog = eventLog.filter((e) => e.ts >= cutoff);
  }
}

export function recordBrowserEvent(event: BrowserLinkEvent): void {
  eventLog.push(event);
  prune(event.ts);
}

/** Mark the wall-clock start of the clip currently being recorded. */
export function openClipWindow(ts: number): void {
  openedAt = ts;
}

/**
 * Compute the web links that were on screen during the clip whose window just
 * closed at `windowEnd`, then return them. The window starts at the last
 * `openClipWindow` timestamp (clamped so it can never exceed MAX_WINDOW_MS).
 */
export function drainClipWebLinks(windowEnd: number): CapturedWebLink[] {
  const windowStart = Math.max(
    openedAt ?? windowEnd - MAX_WINDOW_MS,
    windowEnd - MAX_WINDOW_MS
  );
  return computeClipWebLinks({
    events: eventLog,
    windowStart,
    windowEnd,
  });
}

/** Test-only: reset module state between cases. */
export function __resetBrowserLinkWindow(): void {
  eventLog = [];
  openedAt = null;
}
