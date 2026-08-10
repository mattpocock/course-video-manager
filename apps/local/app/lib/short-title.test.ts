import { describe, it, expect } from "vitest";
import { isDefaultShortTitle } from "./short-title";

describe("isDefaultShortTitle", () => {
  it("returns true for default-format titles", () => {
    expect(isDefaultShortTitle("Short 7/16/2026")).toBe(true);
    expect(isDefaultShortTitle("Short 12/1/2026")).toBe(true);
  });

  it("returns false for edited titles", () => {
    expect(isDefaultShortTitle("The satisfies short")).toBe(false);
    expect(isDefaultShortTitle("My Great Short")).toBe(false);
    expect(isDefaultShortTitle("")).toBe(false);
  });
});
