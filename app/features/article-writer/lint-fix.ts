import type { LintViolation } from "./lint-rules";

/**
 * A document that opens with an ATX heading. Shared with the
 * `no-leading-heading` rule so detection and repair cannot drift apart.
 */
export const LEADING_HEADING_PATTERN = /^#+ /;

/**
 * Removes the heading(s) a document opens with, so the first thing in it is the
 * first paragraph. A single leading heading goes; so does a run of them (an H1
 * followed directly by an H2, say). Headings further down are left alone.
 *
 * A document with no first paragraph to promote — nothing but headings — is
 * returned untouched. Emptying the document is never the fix.
 */
export function stripLeadingHeadings(text: string): string {
  const lines = text.split("\n");

  let lastHeadingIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") continue;
    if (!LEADING_HEADING_PATTERN.test(line)) break;
    lastHeadingIndex = i;
  }

  if (lastHeadingIndex === -1) return text;

  // Drop the headings plus the blank lines separating them from the paragraph.
  let start = lastHeadingIndex + 1;
  while (start < lines.length && (lines[start] ?? "").trim() === "") start++;
  if (start === lines.length) return text;

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
 * part the model has to fix. A rule carrying a `deterministicFix` is applied to
 * the document here and its `fixInstruction` left out of the message — no point
 * asking the model to redo work we have already done.
 *
 * A fix that changes nothing has fixed nothing, so its instruction goes to the
 * model after all. That covers the cases where the deterministic path cannot
 * reach: no document at all (chat mode, where the linted text is the model's
 * own last message), and a document that is not the text the violation was
 * raised against. Pressing Fix therefore always does something.
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
      const repaired = deterministicFix(fixed);
      if (repaired !== fixed) {
        fixed = repaired;
        continue;
      }
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
