import { describe, expect, it } from "vitest";
import { windowedLatency } from "./preview-probe";
import {
  CLOCK_HEIGHT,
  CLOCK_SHARE,
  clockBitCentre,
  CLOCK_BITS,
} from "./synthetic-sources";

const steady = (ms: number) => Array.from({ length: 150 }, () => ms);

describe("windowedLatency (#2675)", () => {
  it("is the median window: one burst of load moves one window, not the metric", () => {
    const burst = [...steady(40), ...Array.from({ length: 30 }, () => 900)];
    const w = windowedLatency(
      [steady(40), steady(45), burst, steady(50), steady(42)],
      5000
    )!;
    expect(w.windows).toBe(5);
    expect(w.p95Ms).toBe(45);
    expect(w.medianMs).toBe(42);
    expect(w.p95RangeMs).toEqual([40, 900]);
    // The burst is still there, in its own window and in the pooled frames.
    expect(w.pooled!.maxMs).toBe(900);
  });

  it("averages the middle two of an even count, and skips empty windows", () => {
    const w = windowedLatency([steady(10), [], steady(20), null], 5000)!;
    expect(w.windows).toBe(2);
    expect(w.p95Ms).toBe(15);
  });

  it("is null with no frames at all", () => {
    expect(windowedLatency([[], null], 5000)).toBeNull();
  });
});

describe("CLOCK_SHARE", () => {
  it("covers every clock bit's centre, and stops above the frame index", () => {
    const lowest = Math.max(
      ...Array.from({ length: CLOCK_BITS }, (_, k) => clockBitCentre(k).y)
    );
    expect(lowest).toBeLessThan(CLOCK_SHARE * CLOCK_HEIGHT);
    expect(CLOCK_SHARE).toBeLessThan(1);
  });
});
