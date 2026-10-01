import { describe, it, expect } from "vitest";
import { createFocusTracker } from "./focus-tracker";

describe("createFocusTracker", () => {
  it("starts unfocused", () => {
    expect(createFocusTracker().isFocused()).toBe(false);
  });

  it("reflects focus and blur live", () => {
    const tracker = createFocusTracker();

    tracker.focus();
    expect(tracker.isFocused()).toBe(true);

    tracker.blur();
    expect(tracker.isFocused()).toBe(false);
  });

  it("notifies subscribers on focus change", () => {
    const tracker = createFocusTracker();
    const seen: boolean[] = [];
    tracker.subscribe((focused) => seen.push(focused));

    tracker.focus();
    tracker.blur();
    tracker.focus();

    expect(seen).toEqual([true, false, true]);
  });

  it("does not notify subscribers when the value does not change", () => {
    const tracker = createFocusTracker();
    const seen: boolean[] = [];
    tracker.subscribe((focused) => seen.push(focused));

    tracker.focus();
    tracker.focus();
    tracker.blur();
    tracker.blur();

    expect(seen).toEqual([true, false]);
  });

  it("stops notifying after unsubscribe", () => {
    const tracker = createFocusTracker();
    const seen: boolean[] = [];
    const unsub = tracker.subscribe((focused) => seen.push(focused));

    tracker.focus();
    unsub();
    tracker.blur();
    tracker.focus();

    expect(seen).toEqual([true]);
  });

  it("keeps each tracker's state separate", () => {
    const a = createFocusTracker();
    const b = createFocusTracker();

    a.focus();

    expect(b.isFocused()).toBe(false);
  });
});
