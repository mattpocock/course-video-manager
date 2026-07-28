import { describe, expect, it } from "vitest";
import {
  TELEPROMPTER_ALIVE_WINDOW_MS,
  isPingFresh,
} from "./teleprompter-window";

describe("isPingFresh", () => {
  it("is false before the popup has ever pinged", () => {
    expect(isPingFresh(0, 60_000)).toBe(false);
  });

  it("is true for a ping inside the window", () => {
    // The popup pings every 2s, so anything within the window means it is there.
    expect(isPingFresh(10_000, 12_000)).toBe(true);
  });

  it("is false once the window has passed with nothing heard", () => {
    expect(isPingFresh(10_000, 10_000 + TELEPROMPTER_ALIVE_WINDOW_MS)).toBe(
      false
    );
  });
});
