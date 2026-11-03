import { describe, expect, it } from "vitest";
import { rank } from "./metrics";
import { longestLowSpeedS } from "./stream-speed";

/** One health a second from `fromS`, each speed in turn. */
const healthEverySecond = (fromS: number, speeds: (number | null)[]) =>
  speeds.map((speed, i) => ({ at: (fromS + i) * 1000, speed }));

describe("the Live Stream's longest stretch under real time", () => {
  it("is 0 for a stream that keeps up", () => {
    const health = healthEverySecond(0, [1, 0.99, 1, 0.98, 1]);
    expect(longestLowSpeedS(health, [[0, 10_000]])).toBe(0);
  });

  it("times a stretch under 0.9 from its first low health to the first back up", () => {
    // 3 s to 8 s read 0.4-0.6x (Whisper on the GPU); back to 1x at 9 s.
    const health = healthEverySecond(
      0,
      [1, 1, 1, 0.5, 0.4, 0.6, 0.5, 0.5, 0.6, 1, 1]
    );
    expect(longestLowSpeedS(health, [[0, 20_000]])).toBe(6);
  });

  it("times a stream still under 0.9 when its span ends to its last health", () => {
    const health = healthEverySecond(0, [1, 0.3, 0.3, 0.3]);
    expect(longestLowSpeedS(health, [[0, 20_000]])).toBe(2);
  });

  it("counts only health inside the spans, so a fault's dip is left out", () => {
    // 5-7 s is the kill: the span stops at 5 s and the next starts at 8 s.
    const health = healthEverySecond(0, [1, 1, 1, 1, 1, 0.1, 0.1, 0.1, 1, 1]);
    expect(
      longestLowSpeedS(health, [
        [0, 5_000],
        [8_000, 10_000],
      ])
    ).toBe(0);
  });

  it("is unmeasured when no health in the spans reads a speed", () => {
    expect(
      longestLowSpeedS(healthEverySecond(0, [null, null]), [[0, 5_000]])
    ).toBeNull();
    expect(longestLowSpeedS([], [[0, 5_000]])).toBeNull();
  });
});

describe("the scorecard on a stream that falls behind", () => {
  const rowFor = (speeds: number[]) =>
    rank({
      stream_low_speed_max_s: longestLowSpeedS(healthEverySecond(0, speeds), [
        [0, 60_000],
      ]),
    }).find((r) => r.id === "stream_low_speed_max_s")!;

  it("FAILs when the encode stays under 0.9x (the 2026-11-03 stream, Whisper on the GPU)", () => {
    const row = rowFor([1, 1, 0.63, 0.4, 0.1, 0.3, 0.5, 0.6, 0.45, 0.2, 1]);
    expect(row.status).toBe("fail");
  });

  it("passes a stream that keeps up, and a single slow second", () => {
    expect(rowFor([1, 0.99, 1, 1]).status).toBe("pass");
    expect(rowFor([1, 0.8, 1, 1]).status).toBe("pass");
  });
});
