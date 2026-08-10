import { describe, it, expect } from "vitest";
import { planLintFix, stripLeadingHeadings } from "./lint-fix";
import { BASE_LINT_RULES, type LintViolation } from "./lint-rules";

function violationOf(id: string, matches: string[]): LintViolation {
  const rule = BASE_LINT_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`No such rule: ${id}`);
  return { rule, count: matches.length, matches };
}

const leadingHeading = () => violationOf("no-leading-heading", ["# "]);
const emDash = () => violationOf("no-em-dash", ["—"]);

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

  it("ignores a hash that is not a heading", () => {
    const doc = "#not-a-heading is a tag\n\nMore.";
    expect(stripLeadingHeadings(doc)).toBe(doc);
  });

  it("promotes a list when that is what follows the heading", () => {
    expect(stripLeadingHeadings("# Title\n\n- one\n- two")).toBe(
      "- one\n- two"
    );
  });

  it("leaves a document that is nothing but headings untouched", () => {
    const doc = "# Title\n\n## Subtitle\n";
    expect(stripLeadingHeadings(doc)).toBe(doc);
  });

  it("leaves a document of headings and whitespace untouched", () => {
    const doc = "# Title\n\n   \n";
    expect(stripLeadingHeadings(doc)).toBe(doc);
  });

  it("leaves an empty document untouched", () => {
    expect(stripLeadingHeadings("")).toBe("");
  });
});

describe("planLintFix", () => {
  it("fixes the leading heading in the document instead of asking the model", () => {
    const plan = planLintFix({
      document: "# Title\n\nThe first paragraph.",
      violations: [leadingHeading()],
    });

    expect(plan).toEqual({ document: "The first paragraph.", message: null });
  });

  it("asks the model only about the violations it cannot fix itself", () => {
    const plan = planLintFix({
      document: "# Title\n\nA sentence — with an em dash.",
      violations: [leadingHeading(), emDash()],
    });

    expect(plan.document).toBe("A sentence — with an em dash.");
    expect(plan.message).toContain("em dash");
    expect(plan.message).not.toContain("heading");
  });

  it("leaves the document alone when nothing is deterministically fixable", () => {
    const plan = planLintFix({
      document: "A sentence — with an em dash.",
      violations: [emDash()],
    });

    expect(plan.document).toBeNull();
    expect(plan.message).toContain("em dash");
  });

  it("asks the model about every violation when there is no document", () => {
    const plan = planLintFix({
      document: undefined,
      violations: [leadingHeading(), emDash()],
    });

    expect(plan.document).toBeNull();
    expect(plan.message).toContain("em dash");
    expect(plan.message).toContain("heading");
  });

  it("reports nothing to do when there are no violations", () => {
    const plan = planLintFix({ document: "All good.", violations: [] });

    expect(plan).toEqual({ document: null, message: null });
  });

  it("asks the model when the deterministic fix changes nothing", () => {
    const plan = planLintFix({
      document: "Already fine.",
      violations: [leadingHeading()],
    });

    expect(plan.document).toBeNull();
    expect(plan.message).toContain("heading");
  });

  it("asks the model when the document is empty", () => {
    const plan = planLintFix({ document: "", violations: [leadingHeading()] });

    expect(plan.document).toBeNull();
    expect(plan.message).toContain("heading");
  });

  it("asks the model rather than emptying a document that is only headings", () => {
    const plan = planLintFix({
      document: "# Title\n\n## Subtitle\n",
      violations: [leadingHeading()],
    });

    expect(plan.document).toBeNull();
    expect(plan.message).toContain("heading");
  });
});
