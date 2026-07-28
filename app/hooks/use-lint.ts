import { useCallback, useMemo } from "react";
import {
  LINT_RULES,
  getLintRulesWithPhrases,
  type LintViolation,
  type BannedPhrase,
} from "@/features/article-writer/lint-rules";
import { planLintFix } from "@/features/article-writer/lint-fix";
import type { Mode } from "@/features/article-writer/types";

/**
 * Hook to check text for lint rule violations.
 *
 * @param text - The text to check for violations
 * @param mode - The current writing mode (determines which rules apply)
 * @param customPhrases - Optional custom banned phrases (if provided, replaces defaults)
 * @returns Object containing the violations array
 *
 * @example
 * ```tsx
 * const { violations } = useLint(lastAssistantMessage, mode, customPhrases);
 *
 * // Turn them into a document rewrite and/or a message for the model:
 * const plan = planLintFix({ document, violations });
 * ```
 */
export function useLint(
  text: string | null,
  mode: Mode,
  customPhrases?: BannedPhrase[]
) {
  const rules = useMemo(() => {
    if (customPhrases) {
      return getLintRulesWithPhrases(customPhrases);
    }
    return LINT_RULES;
  }, [customPhrases]);

  const violations = useMemo(() => {
    if (!text) return [];

    const results: LintViolation[] = [];

    for (const rule of rules) {
      // Skip rules that don't apply to this mode
      if (rule.modes !== null && !rule.modes.includes(mode)) {
        continue;
      }

      // Check for matches
      let matches = text.match(rule.pattern);

      // Apply optional match filter to remove false positives
      if (matches && rule.matchFilter) {
        const filtered = matches.filter(rule.matchFilter);
        matches = filtered.length > 0 ? (filtered as RegExpMatchArray) : null;
      }

      if (rule.required) {
        // Required rules: violation if pattern is NOT present
        if (!matches || matches.length === 0) {
          results.push({
            rule,
            count: 1,
            matches: [],
          });
        }
      } else {
        // Default rules: violation if pattern IS present
        if (matches && matches.length > 0) {
          results.push({
            rule,
            count: matches.length,
            matches: [...matches],
          });
        }
      }
    }

    return results;
  }, [text, mode, rules]);

  return { violations };
}

/**
 * The Fix button's handler. Violations the rules can repair themselves are
 * applied to the document up front — so the model is asked only about what is
 * left, and sees the repaired document when it is asked at all.
 *
 * `documentRef` is read (rather than a document value) because the repair and
 * the send happen in the same tick, before React state catches up. Pass
 * undefined outside document mode, where the linted text is the model's own
 * last message and there is nothing of ours to rewrite.
 */
export function useLintFix(opts: {
  violations: LintViolation[];
  documentRef: { current: string | undefined } | undefined;
  updateDocument: (document: string) => void;
  submitMessage: (text: string) => void;
}) {
  const { violations, documentRef, updateDocument, submitMessage } = opts;
  return useCallback(() => {
    const plan = planLintFix({ document: documentRef?.current, violations });
    if (plan.document !== null) updateDocument(plan.document);
    if (plan.message) submitMessage(plan.message);
  }, [violations, documentRef, updateDocument, submitMessage]);
}
