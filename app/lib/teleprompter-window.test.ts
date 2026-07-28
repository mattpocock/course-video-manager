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

  // A backwards clock step (NTP correcting mid-take) puts `now` behind the
  // ping. The popup is plainly still there, so this must not read as a
  // disconnect and blank the editor's status for a whole take. Rules out
  // "tidying" the elapsed check to an absolute difference.
  it("is true when the clock steps backwards after a ping", () => {
    expect(isPingFresh(10_000, 5_000)).toBe(true);
  });
});
