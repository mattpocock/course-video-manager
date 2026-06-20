import { describe, it, expect } from "vitest";
import { formatThinkingDuration } from "./thinking-trace";

describe("formatThinkingDuration", () => {
  it("returns seconds only when under a minute", () => {
    expect(formatThinkingDuration(0)).toBe("0s");
    expect(formatThinkingDuration(1)).toBe("1s");
    expect(formatThinkingDuration(45)).toBe("45s");
    expect(formatThinkingDuration(59)).toBe("59s");
  });

  it("returns minutes and seconds for 60s and above", () => {
    expect(formatThinkingDuration(60)).toBe("1m 0s");
    expect(formatThinkingDuration(61)).toBe("1m 1s");
    expect(formatThinkingDuration(90)).toBe("1m 30s");
    expect(formatThinkingDuration(125)).toBe("2m 5s");
  });

  it("handles large values", () => {
    expect(formatThinkingDuration(600)).toBe("10m 0s");
    expect(formatThinkingDuration(3661)).toBe("61m 1s");
  });
});
