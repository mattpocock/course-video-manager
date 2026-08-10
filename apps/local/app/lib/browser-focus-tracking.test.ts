import { describe, it, expect, beforeEach } from "vitest";
import {
  isBrowserFocused,
  notifyBrowserFocus,
  notifyBrowserBlur,
  subscribeBrowserFocus,
} from "./browser-focus-tracking";

beforeEach(() => {
  notifyBrowserBlur();
});

describe("browser focus tracking", () => {
  it("starts unfocused", () => {
    expect(isBrowserFocused()).toBe(false);
  });

  it("reflects focus and blur events live", () => {
    notifyBrowserFocus();
    expect(isBrowserFocused()).toBe(true);

    notifyBrowserBlur();
    expect(isBrowserFocused()).toBe(false);
  });

  it("notifies subscribers on focus change", () => {
    const seen: boolean[] = [];
    const unsub = subscribeBrowserFocus((focused) => {
      seen.push(focused);
    });

    notifyBrowserFocus();
    notifyBrowserBlur();
    notifyBrowserFocus();

    expect(seen).toEqual([true, false, true]);
    unsub();
  });

  it("does not notify subscribers when state does not change", () => {
    const seen: boolean[] = [];
    const unsub = subscribeBrowserFocus((focused) => {
      seen.push(focused);
    });

    notifyBrowserFocus();
    notifyBrowserFocus();
    notifyBrowserBlur();
    notifyBrowserBlur();

    expect(seen).toEqual([true, false]);
    unsub();
  });

  it("stops notifying after unsubscribe", () => {
    const seen: boolean[] = [];
    const unsub = subscribeBrowserFocus((focused) => {
      seen.push(focused);
    });

    notifyBrowserFocus();
    unsub();
    notifyBrowserBlur();
    notifyBrowserFocus();

    expect(seen).toEqual([true]);
  });
});
