import { describe, it, expect } from "vitest";
import {
  isCapturableUrl,
  computeClipWebLinks,
  type BrowserLinkEvent,
} from "./clip-web-link-timeline";

describe("isCapturableUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isCapturableUrl("http://example.com")).toBe(true);
    expect(isCapturableUrl("https://example.com/page?x=1")).toBe(true);
    expect(isCapturableUrl("https://localhost:5173/foo")).toBe(true);
  });

  it("rejects file, chrome, edge, about and extension URLs", () => {
    expect(isCapturableUrl("file:///Users/matt/notes.txt")).toBe(false);
    expect(isCapturableUrl("chrome://newtab/")).toBe(false);
    expect(isCapturableUrl("edge://settings")).toBe(false);
    expect(isCapturableUrl("about:blank")).toBe(false);
    expect(isCapturableUrl("chrome-extension://abc/page.html")).toBe(false);
  });

  it("rejects empty and malformed URLs", () => {
    expect(isCapturableUrl("")).toBe(false);
    expect(isCapturableUrl("not a url")).toBe(false);
  });
});

// Window is [1000, 5000] throughout unless stated. Threshold defaults to 1500ms.
const WINDOW_START = 1000;
const WINDOW_END = 5000;
const compute = (events: BrowserLinkEvent[], minVisibleMs = 1500) =>
  computeClipWebLinks({
    events,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    minVisibleMs,
  });

describe("computeClipWebLinks", () => {
  it("captures a URL that is focused and visible for the whole window", () => {
    const links = compute([
      { type: "browser-focus", focused: true, ts: 500 },
      { type: "browser-url", url: "https://a.com", title: "A", ts: 500 },
    ]);
    expect(links).toEqual([
      { url: "https://a.com", title: "A", capturedAt: WINDOW_START },
    ]);
  });

  it("does not capture a URL while Chrome is not focused", () => {
    const links = compute([
      { type: "browser-focus", focused: false, ts: 500 },
      { type: "browser-url", url: "https://a.com", title: "A", ts: 500 },
    ]);
    expect(links).toEqual([]);
  });

  it("drops a URL visible for less than the minimum duration", () => {
    // Visible from 4700..5000 = 300ms, below the 1500ms threshold.
    const links = compute([
      { type: "browser-focus", focused: true, ts: 4700 },
      { type: "browser-url", url: "https://flash.com", title: "F", ts: 4700 },
    ]);
    expect(links).toEqual([]);
  });

  it("captures multiple distinct URLs in chronological order", () => {
    const links = compute([
      { type: "browser-focus", focused: true, ts: 900 },
      { type: "browser-url", url: "https://a.com", title: "A", ts: 900 },
      { type: "browser-url", url: "https://b.com", title: "B", ts: 3000 },
    ]);
    expect(links).toEqual([
      { url: "https://a.com", title: "A", capturedAt: WINDOW_START },
      { url: "https://b.com", title: "B", capturedAt: 3000 },
    ]);
  });

  it("dedupes a URL shown twice (A, B, A) into one row keeping the first sighting", () => {
    const links = compute([
      { type: "browser-focus", focused: true, ts: 900 },
      { type: "browser-url", url: "https://a.com", title: "A", ts: 900 },
      { type: "browser-url", url: "https://b.com", title: "B", ts: 2000 },
      { type: "browser-url", url: "https://a.com", title: "A", ts: 3600 },
    ]);
    // b.com visible 2000..3600 = 1600ms (>= threshold); a.com 1000..2000 +
    // 3600..5000 = 2400ms. Both kept, ordered by first sighting.
    expect(links.map((l) => l.url)).toEqual(["https://a.com", "https://b.com"]);
    expect(links.find((l) => l.url === "https://a.com")!.capturedAt).toBe(
      WINDOW_START
    );
  });

  it("seeds from the URL visible at window open even if it was opened during prior silence", () => {
    // URL set and focused well before the window opens; still visible when the
    // clip starts, so it should attach with capturedAt clamped to windowStart.
    const links = compute([
      { type: "browser-focus", focused: true, ts: 100 },
      { type: "browser-url", url: "https://seed.com", title: "Seed", ts: 200 },
    ]);
    expect(links).toEqual([
      { url: "https://seed.com", title: "Seed", capturedAt: WINDOW_START },
    ]);
  });

  it("ends an interval when switching to a non-capturable URL", () => {
    // a.com visible 900..1200 (200ms in-window) then chrome://newtab from 1200.
    const links = compute([
      { type: "browser-focus", focused: true, ts: 900 },
      { type: "browser-url", url: "https://a.com", title: "A", ts: 900 },
      { type: "browser-url", url: "chrome://newtab/", ts: 1200 },
    ]);
    expect(links).toEqual([]);
  });

  it("ends an interval when Chrome loses focus", () => {
    // Focused 900..1200 (200ms in-window) then blur.
    const links = compute([
      { type: "browser-focus", focused: true, ts: 900 },
      { type: "browser-url", url: "https://a.com", title: "A", ts: 900 },
      { type: "browser-focus", focused: false, ts: 1200 },
    ]);
    expect(links).toEqual([]);
  });

  it("re-attaches a URL after focus returns, summing in-window duration", () => {
    // a.com focused 1000..1400 (400ms), blur, focus again 4000..5000 (1000ms).
    // Total in-window = 1400ms < 1500 -> dropped.
    const dropped = compute([
      { type: "browser-url", url: "https://a.com", title: "A", ts: 900 },
      { type: "browser-focus", focused: true, ts: 1000 },
      { type: "browser-focus", focused: false, ts: 1400 },
      { type: "browser-focus", focused: true, ts: 4000 },
    ]);
    expect(dropped).toEqual([]);

    // Same but the second focused stretch is longer -> total >= 1500 -> kept.
    const kept = compute([
      { type: "browser-url", url: "https://a.com", title: "A", ts: 900 },
      { type: "browser-focus", focused: true, ts: 1000 },
      { type: "browser-focus", focused: false, ts: 1400 },
      { type: "browser-focus", focused: true, ts: 3500 },
    ]);
    expect(kept).toEqual([
      { url: "https://a.com", title: "A", capturedAt: WINDOW_START },
    ]);
  });

  it("returns null title when the URL event carried no title", () => {
    const links = compute([
      { type: "browser-focus", focused: true, ts: 900 },
      { type: "browser-url", url: "https://a.com", ts: 900 },
    ]);
    expect(links).toEqual([
      { url: "https://a.com", title: null, capturedAt: WINDOW_START },
    ]);
  });

  it("ignores events entirely and returns nothing when there is no activity", () => {
    expect(compute([])).toEqual([]);
  });
});
