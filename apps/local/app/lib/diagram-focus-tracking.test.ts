import { describe, it, expect, beforeEach } from "vitest";
import {
  isDiagramFocused,
  notifyDiagramBlur,
  notifyDiagramFocus,
  subscribeDiagramFocus,
} from "./diagram-focus-tracking";

beforeEach(() => {
  notifyDiagramBlur();
});

describe("diagram focus tracking", () => {
  it("starts unfocused", () => {
    expect(isDiagramFocused()).toBe(false);
  });

  it("reflects focus and blur events live", () => {
    notifyDiagramFocus();
    expect(isDiagramFocused()).toBe(true);

    notifyDiagramBlur();
    expect(isDiagramFocused()).toBe(false);
  });

  it("notifies subscribers on focus change", () => {
    const seen: boolean[] = [];
    const unsub = subscribeDiagramFocus((focused) => {
      seen.push(focused);
    });

    notifyDiagramFocus();
    notifyDiagramBlur();
    notifyDiagramFocus();

    expect(seen).toEqual([true, false, true]);
    unsub();
  });

  it("does not notify subscribers when state does not change", () => {
    const seen: boolean[] = [];
    const unsub = subscribeDiagramFocus((focused) => {
      seen.push(focused);
    });

    notifyDiagramFocus();
    notifyDiagramFocus();
    notifyDiagramBlur();
    notifyDiagramBlur();

    expect(seen).toEqual([true, false]);
    unsub();
  });

  it("stops notifying after unsubscribe", () => {
    const seen: boolean[] = [];
    const unsub = subscribeDiagramFocus((focused) => {
      seen.push(focused);
    });

    notifyDiagramFocus();
    unsub();
    notifyDiagramBlur();
    notifyDiagramFocus();

    expect(seen).toEqual([true]);
  });
});
