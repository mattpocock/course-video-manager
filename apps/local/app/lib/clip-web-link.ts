// Shared vocabulary and pure helpers for the web pages captured on screen while
// a clip is recorded.
//
// The Chrome link-capture extension is a dumb tap: it emits `browser-focus` when
// Chrome gains/loses OS focus and `browser-url` when the active tab's URL
// changes. At any instant that stream folds to a single *effective visible URL* —
// the active tab URL when Chrome is focused and the URL is a capturable web page.
//
// The live folding + per-clip accumulation lives in the clip reducer (see
// `browser-event` in `clip-state-reducer-recording.ts`). This module holds only
// the types and pure display helpers so they can be imported from anywhere
// (reducer, UI) without pulling in stateful code.

export type BrowserLinkEvent =
  | { type: "browser-focus"; focused: boolean; ts: number }
  | { type: "browser-url"; url: string; title?: string; ts: number };

export type CapturedWebLink = {
  url: string;
  title: string | null;
  /** Wall-clock time the URL was first captured for the clip. */
  capturedAt: number;
};

/**
 * Minimum milliseconds a page must be continuously visible (Chrome focused,
 * capturable URL unchanged) before it qualifies as a captured web link.
 * Pages flashed for less than this during tab-switching are ignored.
 */
export const WEB_LINK_DWELL_MS = 1500;

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
 * The domain (host) of a URL, for compact inline display.
 * Falls back to the raw string for malformed URLs.
 */
export function getWebLinkLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
