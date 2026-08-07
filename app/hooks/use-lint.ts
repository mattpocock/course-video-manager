import { useCallback, useMemo, type RefObject } from "react";
import {
  EMPTY_LINT_CONTEXT,
  LINT_RULES,
  getLintRulesWithPhrases,
  type LintContext,
  type LintViolation,
  type BannedPhrase,
} from "@/features/article-writer/lint-rules";
import { planLintFix } from "@/features/article-writer/lint-fix";
import { maskQuizNonProse } from "@/features/article-writer/quiz-lint";
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
  customPhrases?: BannedPhrase[],
  context: LintContext = EMPTY_LINT_CONTEXT
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
    // Prose rules read a quiz's question and explanation only — a match on an
    // id or on the JSX around it would carry a fix that breaks the block.
    const prose = maskQuizNonProse(text);

    for (const rule of rules) {
      // Skip rules that don't apply to this mode
      if (rule.modes !== null && !rule.modes.includes(mode)) {
        continue;
      }

      if (rule.detect) {
        const found = rule.detect(text, context);
        if (found.length > 0) {
          results.push({ rule, count: found.length, matches: found });
        }
        continue;
      }

      // Check for matches
      let matches = prose.match(rule.pattern);

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
  }, [text, mode, rules, context]);

  return { violations };
}

/**
 * The Fix button's handler. Violations the rules can repair themselves are
 * applied to the document up front — so the model is asked only about what is
 * left, and sees the repaired document when it is asked at all.
 *
 * The document is read from `documentRef` rather than from state because the
 * repair and the send happen in the same tick, before React state catches up.
 * Outside document mode there is no document of ours to rewrite — the linted
 * text is the model's own last message — so every violation goes to the model.
 */
export function useLintFix(opts: {
  violations: LintViolation[];
  isDocumentMode: boolean;
  documentRef: RefObject<string | undefined>;
  updateDocument: (document: string) => void;
  submitMessage: (text: string) => void;
  context?: LintContext;
}) {
  const {
    violations,
    isDocumentMode,
    documentRef,
    updateDocument,
    submitMessage,
    context = EMPTY_LINT_CONTEXT,
  } = opts;
  return useCallback(() => {
    const plan = planLintFix({
      document: isDocumentMode ? documentRef.current : undefined,
      violations,
      context,
    });
    if (plan.document !== null) updateDocument(plan.document);
    if (plan.message) submitMessage(plan.message);
  }, [
    violations,
    isDocumentMode,
    documentRef,
    updateDocument,
    submitMessage,
    context,
  ]);
}
