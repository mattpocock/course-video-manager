import { describe, expect, it } from "vitest";
import { randomFraction, randomInt } from "@/packages/random";

const draws = <T>(n: number, draw: () => T) => Array.from({ length: n }, draw);

describe("random", () => {
  it("draws fractions in [0, 1)", () => {
    for (const x of draws(1000, randomFraction)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("draws whole numbers below the bound, reaching every one", () => {
    const seen = new Set(draws(1000, () => randomInt(4)));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("refuses a bound that is not a positive whole number", () => {
    expect(() => randomInt(0)).toThrow(RangeError);
    expect(() => randomInt(2.5)).toThrow(RangeError);
  });
});
