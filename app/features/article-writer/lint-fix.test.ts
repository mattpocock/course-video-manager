import { describe, it, expect } from "vitest";
import { planLintFix, stripLeadingHeadings } from "./lint-fix";
import { BASE_LINT_RULES, type LintViolation } from "./lint-rules";

function violationOf(id: string, matches: string[] = []): LintViolation {
  const rule = BASE_LINT_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`No such rule: ${id}`);
  return { rule, count: Math.max(matches.length, 1), matches };
}

describe("stripLeadingHeadings", () => {
  it("removes a single leading heading", () => {
    expect(stripLeadingHeadings("# Title\n\nThe first paragraph.")).toBe(
      "The first paragraph."
    );
  });

  it("removes a heading that is not separated by a blank line", () => {
    expect(stripLeadingHeadings("# Title\nThe first paragraph.")).toBe(
      "The first paragraph."
    );
  });

  it("removes both headings when an H1 is followed directly by an H2", () => {
    expect(
      stripLeadingHeadings("# Title\n\n## Subtitle\n\nThe first paragraph.")
    ).toBe("The first paragraph.");
  });

  it("keeps headings that appear after the first paragraph", () => {
    expect(
      stripLeadingHeadings(
        "# Title\n\nThe first paragraph.\n\n## Later\n\nMore."
      )
    ).toBe("The first paragraph.\n\n## Later\n\nMore.");
  });

  it("leaves content that does not start with a heading untouched", () => {
    const doc = "The first paragraph.\n\n## Later\n\nMore.";
    expect(stripLeadingHeadings(doc)).toBe(doc);
  });

  it("returns an empty string for a document that is only headings", () => {
    expect(stripLeadingHeadings("# Title\n\n## Subtitle\n")).toBe("");
  });

  it("ignores a hash that is not a heading", () => {
    const doc = "#not-a-heading is a tag\n\nMore.";
    expect(stripLeadingHeadings(doc)).toBe(doc);
  });

  it("strips anything the lint rule counts as a heading", () => {
    const rule = BASE_LINT_RULES.find((r) => r.id === "no-leading-heading");
    const doc = "####### Seven hashes\n\nThe first paragraph.";
    expect(rule?.pattern.test(doc)).toBe(true);
    expect(stripLeadingHeadings(doc)).toBe("The first paragraph.");
  });
});

describe("planLintFix", () => {
  it("fixes the leading heading in the document instead of asking the model", () => {
    const plan = planLintFix({
      document: "# Title\n\nThe first paragraph.",
      violations: [violationOf("no-leading-heading", ["# "])],
    });

    expect(plan.document).toBe("The first paragraph.");
    expect(plan.message).toBeNull();
  });

  it("asks the model only about the violations it cannot fix itself", () => {
    const plan = planLintFix({
      document: "# Title\n\nA sentence — with an em dash.",
      violations: [
        violationOf("no-leading-heading", ["# "]),
        violationOf("no-em-dash", ["—"]),
      ],
    });

    expect(plan.document).toBe("A sentence — with an em dash.");
    expect(plan.message).toContain("em dash");
    expect(plan.message).not.toContain("heading");
  });

  it("leaves the document alone when nothing is deterministically fixable", () => {
    const plan = planLintFix({
      document: "A sentence — with an em dash.",
      violations: [violationOf("no-em-dash", ["—"])],
    });

    expect(plan.document).toBeNull();
    expect(plan.message).toContain("em dash");
  });

  it("asks the model about every violation when there is no document", () => {
    const plan = planLintFix({
      document: undefined,
      violations: [
        violationOf("no-leading-heading", ["# "]),
        violationOf("no-em-dash", ["—"]),
      ],
    });

    expect(plan.document).toBeNull();
    expect(plan.message).toContain("em dash");
    expect(plan.message).toContain("heading");
  });

  it("reports nothing to do when there are no violations", () => {
    const plan = planLintFix({ document: "All good.", violations: [] });

    expect(plan.document).toBeNull();
    expect(plan.message).toBeNull();
  });

  it("does not rewrite the document when the deterministic fix is a no-op", () => {
    const plan = planLintFix({
      document: "Already fine.",
      violations: [violationOf("no-leading-heading", ["# "])],
    });

    expect(plan.document).toBeNull();
    expect(plan.message).toBeNull();
  });
});
