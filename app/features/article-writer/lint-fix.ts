import type { LintViolation } from "./lint-rules";

/** An ATX heading line. Deliberately the same shape as the lint rule's
 * pattern, so anything the rule flags is something this can strip. */
const HEADING_LINE = /^#+ /;

/**
 * Removes the heading(s) a document opens with, so the first thing in it is the
 * first paragraph. A single leading heading goes; so does a run of them (an H1
 * followed directly by an H2, say). Headings further down are left alone.
 */
export function stripLeadingHeadings(text: string): string {
  const lines = text.split("\n");

  let lastHeadingIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    if (!HEADING_LINE.test(line)) break;
    lastHeadingIndex = i;
  }

  if (lastHeadingIndex === -1) return text;

  // Drop the headings plus the blank lines separating them from the paragraph.
  let start = lastHeadingIndex + 1;
  while (start < lines.length && (lines[start] ?? "").trim() === "") start++;
  return lines.slice(start).join("\n");
}

export interface LintFixPlan {
  /** The rewritten document, or null when no deterministic fix applied. */
  document: string | null;
  /** The message to send to the model, or null when it has nothing to fix. */
  message: string | null;
}

/**
 * Splits a set of lint violations into the part we can fix ourselves and the
 * part the model has to fix. Rules carrying a `deterministicFix` are applied to
 * the document here and left out of the message entirely — no point asking the
 * model to redo work we have already done. Without a document (chat mode, where
 * the linted text is the model's last message) every violation goes to the model.
 */
export function planLintFix(opts: {
  document: string | undefined;
  violations: LintViolation[];
}): LintFixPlan {
  const { document, violations } = opts;

  let fixed = document;
  const instructions: string[] = [];

  for (const violation of violations) {
    const { deterministicFix, fixInstruction } = violation.rule;
    if (deterministicFix && fixed !== undefined) {
      fixed = deterministicFix(fixed);
      continue;
    }
    instructions.push(
      typeof fixInstruction === "function"
        ? fixInstruction(violation.matches)
        : fixInstruction
    );
  }

  return {
    document: fixed !== undefined && fixed !== document ? fixed : null,
    message:
      instructions.length === 0
        ? null
        : `Please fix the following issues in your response:\n${instructions
            .map((i) => `- ${i}`)
            .join("\n")}\n\nOutput the corrected version.`,
  };
}
