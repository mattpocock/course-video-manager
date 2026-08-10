/**
 * Turning stored `<Quiz>` blocks into something the preview can parse.
 *
 * Each block collapses to a single `<quizblock>` tag carrying its questions as
 * one encoded attribute. The questions keep their *source* offsets, so the card
 * can cut a question at the exact span it came from without asking the offset
 * mapper anything.
 */

import type { PreviewRewrite } from "./preview-rewrites";
import {
  parseQuizBlocks,
  validateQuizQuestion,
  type QuizQuestionData,
} from "./quiz-syntax";

/** One question as the rendered card receives it. */
export interface QuizCardQuestion {
  /** Source offset of the question's `<QuizQuestion` — the handle for cutting it. */
  start: number;
  data?: QuizQuestionData;
  /** Why the tag could not be read, or how it breaks the contract. */
  problems: string[];
}

export interface QuizCardPayload {
  questions: QuizCardQuestion[];
}

export const QUIZ_TAG_NAME = "quizblock";

/** Builds the preview's replacement for every complete quiz block. */
export function collectQuizRewrites(source: string): PreviewRewrite[] {
  return parseQuizBlocks(source).map((block) => {
    const payload: QuizCardPayload = {
      questions: block.questions.map((question) => ({
        start: question.start,
        data: question.data,
        problems: question.error
          ? [question.error]
          : question.data
            ? validateQuizQuestion(question.data)
            : ["The question could not be read."],
      })),
    };
    return {
      start: block.start,
      end: block.end,
      replacement: `<${QUIZ_TAG_NAME} payload="${encodeQuizPayload(payload)}"></${QUIZ_TAG_NAME}>`,
    };
  });
}

/**
 * Encodes a payload for an HTML attribute.
 *
 * `encodeURIComponent` rather than entity escaping: quiz prose carries quotes,
 * angle brackets and newlines, and percent-encoding survives every one of them
 * through the HTML parser unchanged.
 */
export function encodeQuizPayload(payload: QuizCardPayload): string {
  return encodeURIComponent(JSON.stringify(payload));
}

export function decodeQuizPayload(attribute: string): QuizCardPayload {
  try {
    return JSON.parse(decodeURIComponent(attribute)) as QuizCardPayload;
  } catch {
    return { questions: [] };
  }
}
