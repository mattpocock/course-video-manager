/**
 * Reading and writing the `<Quiz>` blocks embedded in a lesson body.
 *
 * The body stores the AI Hero authoring contract verbatim — JSX tags carrying a
 * `data={{ ... }}` object literal — and ships it to AI Hero unparsed. Nothing
 * here rewrites what is stored: the scan exists so the preview can draw a card,
 * so a question can be cut at its exact source range, and so the linters can say
 * what is wrong with a block.
 *
 * A regex cannot do this job. Question and explanation prose contains `}`, `>`
 * and quotes, so the block is found by matching braces with string awareness.
 */

/** One choice a reader can pick. */
export interface QuizChoice {
  answer: string;
  label: string;
}

/** The object literal inside one `<QuizQuestion data={{ ... }} />`. */
export interface QuizQuestionData {
  id: string;
  question: string;
  type: string;
  choices: QuizChoice[];
  /** A string for a single answer; an array makes the question multi-select. */
  correct: string | string[];
  answer: string;
  allowMultiple?: boolean;
  shuffleChoices?: boolean;
}

/**
 * One `<QuizQuestion />` tag, located in the source.
 *
 * `data` is absent when the tag's object literal could not be read at all —
 * `error` then says why. A tag that parses but breaks the contract still
 * carries its `data`; ask {@link validateQuizQuestion} about those.
 */
export interface QuizQuestionBlock {
  /** Offset of `<QuizQuestion` in the source. */
  start: number;
  /** Offset just past the closing `/>`. */
  end: number;
  data?: QuizQuestionData;
  error?: string;
}

/** One `<Quiz>…</Quiz>` region, located in the source. */
export interface QuizBlock {
  /** Offset of `<Quiz>` in the source. */
  start: number;
  /** Offset just past the closing `</Quiz>`. */
  end: number;
  questions: QuizQuestionBlock[];
}

const QUIZ_OPEN = /<Quiz\s*>/g;
const QUIZ_CLOSE = "</Quiz>";
const QUESTION_OPEN = /<QuizQuestion\b/g;

/**
 * Walks a `{`-delimited span, returning the offset just past its matching `}`.
 *
 * Quotes are honoured so a brace inside prose does not close the span. Returns
 * `undefined` when the span never closes — the streaming case, where the writer
 * has emitted half a block.
 */
function matchBraces(source: string, open: number): number | undefined {
  let depth = 0;
  let quote: string | undefined;
  for (let i = open; i < source.length; i++) {
    const char = source[i]!;
    if (quote) {
      if (char === "\\") i++;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return undefined;
}

/**
 * Finds every complete `<Quiz>` block in a document.
 *
 * An unclosed block is skipped entirely, which is what keeps a streaming
 * document legible: until `</Quiz>` arrives the fragment stays untouched and
 * renders as ordinary text.
 */
export function parseQuizBlocks(source: string): QuizBlock[] {
  const blocks: QuizBlock[] = [];
  QUIZ_OPEN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = QUIZ_OPEN.exec(source)) !== null) {
    const start = match.index;
    const bodyStart = start + match[0].length;
    const closeAt = source.indexOf(QUIZ_CLOSE, bodyStart);
    if (closeAt === -1) break;

    const end = closeAt + QUIZ_CLOSE.length;
    blocks.push({
      start,
      end,
      questions: parseQuestions(source, bodyStart, closeAt),
    });
    QUIZ_OPEN.lastIndex = end;
  }

  return blocks;
}

function parseQuestions(
  source: string,
  from: number,
  to: number
): QuizQuestionBlock[] {
  const questions: QuizQuestionBlock[] = [];
  QUESTION_OPEN.lastIndex = from;
  let match: RegExpExecArray | null;

  while ((match = QUESTION_OPEN.exec(source)) !== null) {
    if (match.index >= to) break;
    const start = match.index;

    const dataAt = source.indexOf("data=", start);
    const braceAt = dataAt === -1 ? -1 : source.indexOf("{", dataAt);
    if (braceAt === -1 || braceAt >= to) {
      questions.push({ start, end: to, error: "The tag has no `data` prop." });
      break;
    }

    const braceEnd = matchBraces(source, braceAt);
    if (braceEnd === undefined || braceEnd > to) {
      questions.push({
        start,
        end: to,
        error: "The `data` prop never closes.",
      });
      break;
    }

    const selfClose = source.indexOf("/>", braceEnd);
    const end = selfClose === -1 || selfClose > to ? braceEnd : selfClose + 2;

    // `data={{ … }}` — the outer brace is the JSX expression, the inner one the
    // object literal we actually want.
    const expression = source.slice(braceAt + 1, braceEnd - 1).trim();
    const parsed = parseObjectLiteral(expression);

    questions.push(
      "error" in parsed
        ? { start, end, error: parsed.error }
        : { start, end, data: parsed.value as QuizQuestionData }
    );
    QUESTION_OPEN.lastIndex = end;
  }

  return questions;
}

type ParseResult = { value: unknown } | { error: string };

/**
 * Reads a static JavaScript object literal.
 *
 * Only literals are accepted — strings, numbers, booleans, `null`, arrays and
 * objects. A spread, a variable, a call or a conditional is rejected rather
 * than evaluated, which is both the contract's rule and the reason this is a
 * parser and not an `eval`.
 */
export function parseObjectLiteral(source: string): ParseResult {
  let at = 0;

  const fail = (message: string): ParseResult => ({ error: message });

  const skipSpace = () => {
    while (at < source.length && /\s/.test(source[at]!)) at++;
  };

  const readString = (): ParseResult => {
    const quote = source[at]!;
    at++;
    let out = "";
    while (at < source.length) {
      const char = source[at]!;
      if (char === "\\") {
        const next = source[at + 1];
        out +=
          next === "n"
            ? "\n"
            : next === "t"
              ? "\t"
              : next === "r"
                ? "\r"
                : (next ?? "");
        at += 2;
        continue;
      }
      if (char === quote) {
        at++;
        return { value: out };
      }
      out += char;
      at++;
    }
    return fail("A string never closes.");
  };

  const readValue = (): ParseResult => {
    skipSpace();
    const char = source[at];
    if (char === undefined) return fail("The value is missing.");
    if (char === '"' || char === "'" || char === "`") return readString();
    if (char === "{") return readObject();
    if (char === "[") return readArray();

    const word = /^(true|false|null)\b/.exec(source.slice(at));
    if (word) {
      at += word[0].length;
      return {
        value: word[0] === "true" ? true : word[0] === "false" ? false : null,
      };
    }

    const number = /^-?\d+(\.\d+)?/.exec(source.slice(at));
    if (number) {
      at += number[0].length;
      return { value: Number(number[0]) };
    }

    return fail(
      "Only literal values are allowed — a spread, variable, call or conditional cannot be read."
    );
  };

  const readArray = (): ParseResult => {
    at++; // [
    const out: unknown[] = [];
    for (;;) {
      skipSpace();
      if (source[at] === "]") {
        at++;
        return { value: out };
      }
      const item = readValue();
      if ("error" in item) return item;
      out.push(item.value);
      skipSpace();
      if (source[at] === ",") at++;
      else if (source[at] !== "]") return fail("An array item is malformed.");
    }
  };

  const readObject = (): ParseResult => {
    at++; // {
    const out: Record<string, unknown> = {};
    for (;;) {
      skipSpace();
      if (source[at] === "}") {
        at++;
        return { value: out };
      }
      if (source[at] === ".") return fail("A spread is not allowed in `data`.");

      let key: string;
      const char = source[at];
      if (char === '"' || char === "'") {
        const read = readString();
        if ("error" in read) return read;
        key = read.value as string;
      } else {
        const name = /^[A-Za-z_$][\w$]*/.exec(source.slice(at));
        if (!name) return fail("A key is malformed.");
        key = name[0];
        at += key.length;
      }

      skipSpace();
      if (source[at] !== ":") return fail(`The key \`${key}\` has no value.`);
      at++;

      const value = readValue();
      if ("error" in value) return value;
      out[key] = value.value;

      skipSpace();
      if (source[at] === ",") at++;
      else if (source[at] !== "}") return fail("A property is malformed.");
    }
  };

  skipSpace();
  if (source[at] !== "{") return fail("The `data` prop holds no object.");
  const result = readObject();
  if ("error" in result) return result;
  skipSpace();
  if (at !== source.length) return fail("There is text after the object.");
  return result;
}

/**
 * Checks one question against the AI Hero contract, ignoring id uniqueness —
 * that is a property of the whole course, not of one block, and lives with the
 * linters that can see the course.
 */
export function validateQuizQuestion(data: QuizQuestionData): string[] {
  const problems: string[] = [];

  if (!data.id?.trim()) problems.push("`id` is missing.");
  if (!data.question?.trim()) problems.push("`question` is empty.");
  if (!data.answer?.trim()) problems.push("`answer` is empty.");
  if (data.type !== "multiple-choice")
    problems.push("`type` must be `multiple-choice`.");

  const choices = Array.isArray(data.choices) ? data.choices : [];
  if (choices.length < 2)
    problems.push("A question needs two or more choices.");

  const seen = new Set<string>();
  for (const choice of choices) {
    if (!choice?.answer?.trim() || !choice?.label?.trim()) {
      problems.push("A choice has an empty `answer` or `label`.");
      continue;
    }
    if (seen.has(choice.answer))
      problems.push(`Two choices share the answer \`${choice.answer}\`.`);
    seen.add(choice.answer);
  }

  const correct = Array.isArray(data.correct) ? data.correct : [data.correct];
  if (correct.length === 0 || correct.some((value) => !value)) {
    problems.push("`correct` is missing.");
  } else {
    for (const value of correct) {
      if (!seen.has(value))
        problems.push(`\`correct\` names \`${value}\`, which is not a choice.`);
    }
  }

  return problems;
}

/** Every quiz id in a document, in source order, skipping unreadable tags. */
export function collectQuizIds(source: string): string[] {
  return parseQuizBlocks(source).flatMap((block) =>
    block.questions.flatMap((question) =>
      question.data?.id ? [question.data.id] : []
    )
  );
}

/**
 * Cuts one question out of a document.
 *
 * The block goes with its last question: an empty `<Quiz></Quiz>` renders as
 * nothing and would only have to be deleted by hand afterwards.
 */
export function removeQuizQuestion(source: string, questionStart: number) {
  const block = parseQuizBlocks(source).find(
    (candidate) =>
      questionStart >= candidate.start && questionStart < candidate.end
  );
  if (!block) return source;

  const question = block.questions.find(
    (candidate) => candidate.start === questionStart
  );
  if (!question) return source;

  const [start, end] =
    block.questions.length === 1
      ? [block.start, block.end]
      : [question.start, question.end];

  return cut(source, start, end);
}

/** Removes a span along with the blank line it leaves behind. */
function cut(source: string, start: number, end: number): string {
  let from = start;
  while (from > 0 && (source[from - 1] === " " || source[from - 1] === "\t"))
    from--;
  let to = end;
  while (to < source.length && (source[to] === " " || source[to] === "\t"))
    to++;
  if (source[to] === "\n") to++;
  if (from > 0 && source[from - 1] === "\n" && source[to] === "\n") to++;
  return source.slice(0, from) + source.slice(to);
}
