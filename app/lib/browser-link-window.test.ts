import { describe, it, expect, beforeEach } from "vitest";
import {
  recordBrowserEvent,
  openClipWindow,
  drainClipWebLinks,
  __resetBrowserLinkWindow,
} from "./browser-link-window";

describe("browser-link-window", () => {
  beforeEach(() => {
    __resetBrowserLinkWindow();
  });

  it("attaches a URL shown throughout the clip window", () => {
    recordBrowserEvent({ type: "browser-focus", focused: true, ts: 1000 });
    recordBrowserEvent({
      type: "browser-url",
      url: "https://a.com",
      title: "A",
      ts: 1000,
    });
    openClipWindow(1000);
    const links = drainClipWebLinks(6000);
    expect(links).toEqual([
      { url: "https://a.com", title: "A", capturedAt: 1000 },
    ]);
  });

  it("only counts activity since the clip window opened (silence-gap URLs are dropped)", () => {
    // A shown-and-dismissed page during the silence gap before the clip opens.
    recordBrowserEvent({ type: "browser-focus", focused: true, ts: 100 });
    recordBrowserEvent({
      type: "browser-url",
      url: "https://gap.com",
      title: "Gap",
      ts: 100,
    });
    recordBrowserEvent({
      type: "browser-url",
      url: "chrome://newtab/",
      ts: 500,
    });
    // Clip opens at 2000; a different page is shown for the whole window.
    recordBrowserEvent({
      type: "browser-url",
      url: "https://clip.com",
      title: "Clip",
      ts: 2000,
    });
    openClipWindow(2000);
    const links = drainClipWebLinks(7000);
    expect(links).toEqual([
      { url: "https://clip.com", title: "Clip", capturedAt: 2000 },
    ]);
  });

  it("seeds from a page opened during silence that is still visible at clip open", () => {
    recordBrowserEvent({ type: "browser-focus", focused: true, ts: 100 });
    recordBrowserEvent({
      type: "browser-url",
      url: "https://seed.com",
      title: "Seed",
      ts: 200,
    });
    // No navigation before the clip opens — still visible.
    openClipWindow(3000);
    const links = drainClipWebLinks(8000);
    expect(links).toEqual([
      { url: "https://seed.com", title: "Seed", capturedAt: 3000 },
    ]);
  });
});
