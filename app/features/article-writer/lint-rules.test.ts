import { describe, it, expect } from "vitest";
import { BASE_LINT_RULES, LINT_RULES } from "./lint-rules";

describe("lint rules", () => {
  it("should not include the no-orphaned-paragraph rule", () => {
    const ids = BASE_LINT_RULES.map((r) => r.id);
    expect(ids).not.toContain("no-orphaned-paragraph");
  });

  it("should not include the no-orphaned-paragraph rule in composed LINT_RULES", () => {
    const ids = LINT_RULES.map((r) => r.id);
    expect(ids).not.toContain("no-orphaned-paragraph");
  });
});
