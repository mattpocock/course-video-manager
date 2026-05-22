import type { Mode } from "./types";

/**
 * Represents a single lint rule that can be applied to article writer output.
 */
export interface LintRule {
  /** Unique identifier for the rule */
  id: string;
  /** Human-readable name of the rule */
  name: string;
  /** Description of what the rule checks for */
  description: string;
  /** Modes this rule applies to (null = all modes) */
  modes: Mode[] | null;
  /** Regular expression pattern to detect violations */
  pattern: RegExp;
  /** Instruction to include in fix message (static string or function that receives matched text) */
  fixInstruction: string | ((matches: string[]) => string);
  /** If true, the pattern must be present (violation if missing). Default: false (violation if present) */
  required?: boolean;
  /** Optional filter to exclude false-positive matches. Return true to keep the match. */
  matchFilter?: (match: string) => boolean;
}

/**
 * Represents a detected violation of a lint rule.
 */
export interface LintViolation {
  /** The rule that was violated */
  rule: LintRule;
  /** Number of times the violation appears */
  count: number;
  /** The actual matched text for each violation */
  matches: string[];
}

/**
 * Represents a custom banned phrase with optional case sensitivity.
 */
export interface BannedPhrase {
  /** The phrase pattern (can include regex syntax) */
  pattern: string;
  /** Human-readable description */
  readable: string;
  /** Whether the match should be case sensitive */
  caseSensitive: boolean;
}

/**
 * Default banned phrases that are dead giveaways of LLM-generated content.
 * These should be avoided in all article writing.
 * Some patterns use regex syntax for context-aware matching.
 */
export const DEFAULT_BANNED_PHRASES: BannedPhrase[] = [
  {
    pattern: "uncomfortable truth",
    readable: "uncomfortable truth",
    caseSensitive: false,
  },
  { pattern: "hard truth", readable: "hard truth", caseSensitive: false },
  {
    pattern: "spoiler[,:]",
    readable: "spoiler (when followed by comma or colon)",
    caseSensitive: false,
  },
  {
    pattern: "here's the thing:",
    readable: "here's the thing:",
    caseSensitive: false,
  },
  { pattern: "yeah", readable: "yeah", caseSensitive: false },
  {
    pattern: "it's kind of like",
    readable: "it's kind of like",
    caseSensitive: false,
  },
  {
    pattern: "game[ -]?changer",
    readable: "game changer / game-changer",
    caseSensitive: false,
  },
  {
    pattern: "the reality[?!:;.,]",
    readable: "the reality (when followed by punctuation)",
    caseSensitive: false,
  },
  {
    pattern: "the good news[?:]",
    readable: "the good news (when followed by ? or :)",
    caseSensitive: false,
  },
  {
    pattern: "the irony[?]",
    readable: "the irony (when followed by ?)",
    caseSensitive: false,
  },
  {
    pattern: "problem solved[.!]",
    readable: "problem solved (when followed by . or !)",
    caseSensitive: false,
  },
];

/**
 * Creates individual lint rules for each banned phrase.
 * This allows the fix message to only include phrases that were actually detected.
 */
export function createBannedPhraseRules(phrases: BannedPhrase[]): LintRule[] {
  return phrases.map((phrase, index) => ({
    id: `no-llm-phrase-${index}`,
    name: "No LLM Phrases",
    description: "Phrases that are dead giveaways of LLM-generated content",
    modes: null,
    pattern: new RegExp(phrase.pattern, phrase.caseSensitive ? "g" : "gi"),
    fixInstruction: `Remove or rephrase: "${phrase.readable}"`,
  }));
}

/**
 * The greeting sigil that must appear at the start of every newsletter.
 * Uses Liquid templating syntax for personalization.
 */
export const NEWSLETTER_GREETING_SIGIL = `Hey {{ subscriber.first_name | strip | default: "there" }},`;

/**
 * Base lint rules (excluding banned phrases which are customizable).
 */
export const BASE_LINT_RULES: LintRule[] = [
  {
    id: "no-em-dash",
    name: "No Em Dashes",
    description: "Em dashes (—) should not be used in content",
    modes: null, // Applies to all modes
    pattern: /—/g,
    fixInstruction: "Replace all em dashes (—) with hyphens (-) or commas",
  },
  {
    id: "newsletter-greeting",
    name: "Newsletter Greeting",
    description: "Newsletter must start with the personalized greeting sigil",
    modes: ["newsletter"],
    pattern: new RegExp(
      "^" + NEWSLETTER_GREETING_SIGIL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    ),
    fixInstruction: `The newsletter must start with exactly: ${NEWSLETTER_GREETING_SIGIL}`,
    required: true,
  },
  {
    id: "no-leading-heading",
    name: "No Leading Heading",
    description: "Content must not start with a markdown heading",
    modes: ["article", "skill-building"],
    pattern: /^#+ /,
    fixInstruction:
      "Remove the markdown heading from the start of the content. Do not start with a heading - begin directly with the content.",
  },
];

/**
 * All lint rules for the article writer (using default banned phrases).
 * For custom banned phrases, use getLintRulesWithPhrases() instead.
 */
export const LINT_RULES: LintRule[] = [
  ...BASE_LINT_RULES,
  ...createBannedPhraseRules(DEFAULT_BANNED_PHRASES),
];

/**
 * Get lint rules with custom banned phrases.
 */
export function getLintRulesWithPhrases(phrases: BannedPhrase[]): LintRule[] {
  if (phrases.length === 0) {
    return BASE_LINT_RULES;
  }
  return [...BASE_LINT_RULES, ...createBannedPhraseRules(phrases)];
}
