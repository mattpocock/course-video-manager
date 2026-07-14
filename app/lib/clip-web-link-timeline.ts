// Pure reconstruction of "which web pages were on screen during a clip" from
// the raw browser event stream emitted by the link-capture Chrome extension.
//
// The extension is a dumb tap: it emits `browser-focus` when Chrome gains/loses
// OS focus and `browser-url` when the active tab's URL changes. From that stream
// we reconstruct, for any instant, the *effective visible URL* — the active tab
// URL when Chrome is focused and the URL is a capturable web page. We then
// intersect each URL's visible intervals with the clip's wall-clock window and
// keep the URLs that were visible long enough.
//
// This module is intentionally pure (no `Date.now`, no I/O) so it can be unit
// tested exhaustively. The live singleton in `browser-link-window.ts` records
// timestamped events and calls into this for the actual computation.

export type BrowserLinkEvent =
  | { type: "browser-focus"; focused: boolean; ts: number }
  | { type: "browser-url"; url: string; title?: string; ts: number };

export type CapturedWebLink = {
  url: string;
  title: string | null;
  /** Wall-clock time the URL was first visible within the clip window. */
  capturedAt: number;
};

/**
 * Minimum time (ms) a URL must be effectively visible within a clip's window
 * before it is attached. Filters transient flashes as you tab between windows.
 */
export const DEFAULT_MIN_VISIBLE_MS = 1500;

/**
 * A URL is capturable if it is an ordinary web page (http/https). File URLs,
 * browser-internal pages (`chrome://`, `edge://`, `about:`) and extension pages
 * are skipped.
 */
export function isCapturableUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * A short human label for a URL when no page title is available: host + path,
 * without the scheme or a trailing slash. Falls back to the raw URL.
 */
export function getWebLinkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.host}${path}${parsed.search}`;
  } catch {
    return url;
  }
}

type Accumulated = {
  visibleMs: number;
  capturedAt: number;
  title: string | null;
};

export function computeClipWebLinks(input: {
  events: readonly BrowserLinkEvent[];
  windowStart: number;
  windowEnd: number;
  minVisibleMs?: number;
}): CapturedWebLink[] {
  const { windowStart, windowEnd } = input;
  const minVisibleMs = input.minVisibleMs ?? DEFAULT_MIN_VISIBLE_MS;
  if (windowEnd <= windowStart) return [];

  const sorted = [...input.events].sort((a, b) => a.ts - b.ts);

  const totals = new Map<string, Accumulated>();

  // Effective-visible state, updated as we consume each event. Each event takes
  // effect from its own timestamp; the resulting state holds until the next
  // event (or the end of the window for the final event).
  let focused = false;
  let rawUrl: string | null = null;
  let rawTitle: string | null = null;

  const effectiveUrl = (): string | null =>
    focused && rawUrl !== null && isCapturableUrl(rawUrl) ? rawUrl : null;

  const accumulate = (url: string, title: string | null, segStart: number, segEnd: number) => {
    const start = Math.max(segStart, windowStart);
    const end = Math.min(segEnd, windowEnd);
    if (end <= start) return;
    const existing = totals.get(url);
    if (existing) {
      existing.visibleMs += end - start;
      // Keep the earliest sighting's capturedAt and title. Events are processed
      // in chronological order, so the first insert already holds the earliest.
    } else {
      totals.set(url, { visibleMs: end - start, capturedAt: start, title });
    }
  };

  for (let i = 0; i < sorted.length; i++) {
    const event = sorted[i]!;
    if (event.type === "browser-focus") {
      focused = event.focused;
    } else {
      rawUrl = event.url;
      rawTitle = event.title ?? null;
    }

    const segStart = event.ts;
    const segEnd = i + 1 < sorted.length ? sorted[i + 1]!.ts : windowEnd;
    const eff = effectiveUrl();
    if (eff !== null) {
      accumulate(eff, rawTitle, segStart, segEnd);
    }
  }

  return [...totals.entries()]
    .filter(([, acc]) => acc.visibleMs >= minVisibleMs)
    .map(([url, acc]) => ({
      url,
      title: acc.title,
      capturedAt: acc.capturedAt,
    }))
    .sort((a, b) => a.capturedAt - b.capturedAt);
}
