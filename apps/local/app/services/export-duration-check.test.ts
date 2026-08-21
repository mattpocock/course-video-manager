import { describe, it, expect } from "vitest";
import {
  EXPORT_DURATION_TOLERANCE_IN_SECONDS,
  LONG_PAUSE_DURATION_IN_SECONDS,
  expectedExportDurationInSeconds,
  isExportUnacceptablyShort,
} from "./export-duration-check";

const verdict = (expected: number, actual: number) =>
  isExportUnacceptablyShort({
    expectedDurationInSeconds: expected,
    actualDurationInSeconds: actual,
  });

describe("isExportUnacceptablyShort", () => {
  it("accepts an export that is exactly as long as its Clips ask for", () => {
    expect(verdict(100, 100)).toBe(false);
  });

  it("accepts an export short by less than the tolerance", () => {
    expect(verdict(100, 100 - EXPORT_DURATION_TOLERANCE_IN_SECONDS + 0.01)).toBe(
      false
    );
  });

  it("accepts an export short by exactly the tolerance", () => {
    expect(verdict(100, 100 - EXPORT_DURATION_TOLERANCE_IN_SECONDS)).toBe(false);
  });

  it("refuses an export short by more than the tolerance", () => {
    expect(verdict(100, 100 - EXPORT_DURATION_TOLERANCE_IN_SECONDS - 0.01)).toBe(
      true
    );
  });

  it("refuses each of the three truncations found on disk", () => {
    expect(verdict(271.8, 200.5)).toBe(true);
    expect(verdict(316.1, 281.8)).toBe(true);
    expect(verdict(806.8, 797.2)).toBe(true);
  });

  it("accepts an export longer than its Clips ask for", () => {
    // Container rounding must never fail a good release.
    expect(verdict(100, 100.4)).toBe(false);
    expect(verdict(100, 1000)).toBe(false);
  });

  it("refuses a zero-length export, however little was expected", () => {
    expect(verdict(100, 0)).toBe(true);
    expect(verdict(0.5, 0)).toBe(true);
    expect(verdict(0, 0)).toBe(true);
  });

  it("refuses an export whose duration could not be measured", () => {
    expect(verdict(100, Number.NaN)).toBe(true);
  });
});

describe("expectedExportDurationInSeconds", () => {
  it("is the Clips end to end", () => {
    expect(
      expectedExportDurationInSeconds([
        { duration: 10, pauseType: "none" },
        { duration: 2.5, pauseType: "none" },
      ])
    ).toBe(12.5);
  });

  it("extends a Clip that ends in a long Pause", () => {
    expect(
      expectedExportDurationInSeconds([
        { duration: 10, pauseType: "long" },
        { duration: 10, pauseType: "none" },
      ])
    ).toBeCloseTo(20 + LONG_PAUSE_DURATION_IN_SECONDS, 10);
  });

  it("expects nothing of a Video with no Clips", () => {
    expect(expectedExportDurationInSeconds([])).toBe(0);
  });
});
