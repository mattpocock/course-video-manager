import { describe, expect, it } from "vitest";
import {
  ANIMATIC_PLAYBACK_RATES,
  DEFAULT_ANIMATIC_PLAYBACK_RATE,
  parseAnimaticPlaybackRate,
} from "./animatic-playback-rate";

/**
 * The stored rate is read back into a `<Player playbackRate>` on the next
 * Animatic. A value the speed control does not list would show as a control
 * stuck on a number it cannot offer, and a value Remotion refuses (0, or over
 * 4) would throw the page down on mount — so every reading is tested, not
 * only the good one.
 */

describe("parseAnimaticPlaybackRate", () => {
  it("gives two times when nothing is stored", () => {
    expect(parseAnimaticPlaybackRate(null)).toBe(2);
    expect(DEFAULT_ANIMATIC_PLAYBACK_RATE).toBe(2);
  });

  it("gives back every rate the control offers", () => {
    for (const rate of ANIMATIC_PLAYBACK_RATES) {
      expect(parseAnimaticPlaybackRate(String(rate))).toBe(rate);
    }
  });

  it("falls back for a rate the control does not offer", () => {
    expect(parseAnimaticPlaybackRate("1.75")).toBe(2);
    expect(parseAnimaticPlaybackRate("4")).toBe(2);
  });

  it("falls back for a value Remotion would refuse", () => {
    expect(parseAnimaticPlaybackRate("0")).toBe(2);
    expect(parseAnimaticPlaybackRate("-2")).toBe(2);
    expect(parseAnimaticPlaybackRate("100")).toBe(2);
  });

  it("falls back for junk", () => {
    expect(parseAnimaticPlaybackRate("")).toBe(2);
    expect(parseAnimaticPlaybackRate("fast")).toBe(2);
    expect(parseAnimaticPlaybackRate("null")).toBe(2);
  });

  it("offers no rate Remotion refuses", () => {
    for (const rate of ANIMATIC_PLAYBACK_RATES) {
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThanOrEqual(4);
    }
    expect(ANIMATIC_PLAYBACK_RATES).toContain(DEFAULT_ANIMATIC_PLAYBACK_RATE);
  });
});
