import { describe, expect, it } from "vitest";
import {
  collectQuizIds,
  parseObjectLiteral,
  parseQuizBlocks,
  removeQuizQuestion,
  validateQuizQuestion,
  type QuizQuestionData,
} from "./quiz-syntax";

const question = (id: string, extra = "") => `  <QuizQuestion data={{
    id: "${id}",
    question: "Which one?",
    type: "multiple-choice",
    choices: [
      { answer: "a", label: "Option one" },
      { answer: "b", label: "Option two" }
    ],
    correct: "a",
    answer: "Because."${extra}
  }} />`;

const quiz = (...ids: string[]) =>
  `<Quiz>\n${ids.map((id) => question(id)).join("\n")}\n</Quiz>`;

describe("parseQuizBlocks", () => {
  it("reads a question's data", () => {
    const blocks = parseQuizBlocks(quiz("first"));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.questions[0]!.data).toMatchObject({
      id: "first",
      type: "multiple-choice",
      correct: "a",
      choices: [
        { answer: "a", label: "Option one" },
        { answer: "b", label: "Option two" },
      ],
    });
  });

  it("locates the block in the source", () => {
    const source = `Intro.\n\n${quiz("first")}\n\nOutro.`;
    const block = parseQuizBlocks(source)[0]!;
    expect(source.slice(block.start, block.end)).toBe(quiz("first"));
  });

  it("reads several questions in one block", () => {
    expect(parseQuizBlocks(quiz("a", "b", "c"))[0]!.questions).toHaveLength(3);
  });

  it("skips a block that never closes, which is the streaming case", () => {
    expect(parseQuizBlocks(`<Quiz>\n${question("half")}`)).toEqual([]);
  });

  it("holds a brace inside prose", () => {
    const source = `<Quiz>
  <QuizQuestion data={{
    id: "braces",
    question: "What does {} mean?",
    type: "multiple-choice",
    choices: [
      { answer: "a", label: "An empty object }" },
      { answer: "b", label: "A block" }
    ],
    correct: "a",
    answer: "It is an empty object literal."
  }} />
</Quiz>`;
    const data = parseQuizBlocks(source)[0]!.questions[0]!.data!;
    expect(data.question).toBe("What does {} mean?");
    expect(data.choices[0]!.label).toBe("An empty object }");
  });

  it("holds an angle bracket inside prose", () => {
    const source = `<Quiz>
  <QuizQuestion data={{
    id: "angles",
    question: "Is a < b?",
    type: "multiple-choice",
    choices: [
      { answer: "a", label: "Yes" },
      { answer: "b", label: "No" }
    ],
    correct: "a",
    answer: "Yes, when a is smaller."
  }} />
</Quiz>`;
    expect(parseQuizBlocks(source)[0]!.questions[0]!.data!.question).toBe(
      "Is a < b?"
    );
  });

  it("reports a question it cannot read", () => {
    const source = `<Quiz>
  <QuizQuestion data={{ id: someVariable }} />
</Quiz>`;
    expect(parseQuizBlocks(source)[0]!.questions[0]!.error).toBeTruthy();
  });
});

describe("parseObjectLiteral", () => {
  it("reads nested literals", () => {
    expect(
      parseObjectLiteral(`{ a: [1, true, null], b: { c: 'x' }, }`)
    ).toEqual({ value: { a: [1, true, null], b: { c: "x" } } });
  });

  it("rejects a spread", () => {
    expect(parseObjectLiteral(`{ ...base, id: "x" }`)).toHaveProperty("error");
  });

  it("rejects a function call", () => {
    expect(parseObjectLiteral(`{ id: makeId() }`)).toHaveProperty("error");
  });

  it("rejects a conditional", () => {
    expect(parseObjectLiteral(`{ id: flag ? "a" : "b" }`)).toHaveProperty(
      "error"
    );
  });
});

describe("validateQuizQuestion", () => {
  const valid: QuizQuestionData = {
    id: "valid",
    question: "Which one?",
    type: "multiple-choice",
    choices: [
      { answer: "a", label: "One" },
      { answer: "b", label: "Two" },
    ],
    correct: "a",
    answer: "Because.",
  };

  it("passes a question that meets the contract", () => {
    expect(validateQuizQuestion(valid)).toEqual([]);
  });

  it("rejects fewer than two choices", () => {
    expect(
      validateQuizQuestion({ ...valid, choices: [valid.choices[0]!] })
    ).toContain("A question needs two or more choices.");
  });

  it("rejects two choices sharing an answer", () => {
    expect(
      validateQuizQuestion({
        ...valid,
        choices: [valid.choices[0]!, { answer: "a", label: "Two" }],
      })
    ).toContainEqual(expect.stringContaining("share the answer"));
  });

  it("rejects a correct value with no matching choice", () => {
    expect(validateQuizQuestion({ ...valid, correct: "z" })).toContainEqual(
      expect.stringContaining("not a choice")
    );
  });

  it("rejects an empty explanation", () => {
    expect(validateQuizQuestion({ ...valid, answer: "  " })).toContain(
      "`answer` is empty."
    );
  });

  it("rejects a type other than multiple-choice", () => {
    expect(validateQuizQuestion({ ...valid, type: "freeform" })).toContain(
      "`type` must be `multiple-choice`."
    );
  });

  it("accepts a multi-select question", () => {
    expect(validateQuizQuestion({ ...valid, correct: ["a", "b"] })).toEqual([]);
  });
});

describe("collectQuizIds", () => {
  it("lists every id in source order", () => {
    expect(collectQuizIds(`${quiz("a", "b")}\n\n${quiz("c")}`)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("removeQuizQuestion", () => {
  it("cuts one question and leaves its siblings", () => {
    const source = quiz("a", "b");
    const target = parseQuizBlocks(source)[0]!.questions[1]!;
    const result = removeQuizQuestion(source, target.start);
    expect(collectQuizIds(result)).toEqual(["a"]);
    expect(result).toContain("</Quiz>");
  });

  it("takes the block with the last question", () => {
    const source = `Intro.\n\n${quiz("only")}\n\nOutro.`;
    const target = parseQuizBlocks(source)[0]!.questions[0]!;
    const result = removeQuizQuestion(source, target.start);
    expect(result).not.toContain("Quiz");
    expect(result).toContain("Intro.");
    expect(result).toContain("Outro.");
  });

  it("leaves the document alone when the offset names no question", () => {
    const source = quiz("a");
    expect(removeQuizQuestion(source, 9999)).toBe(source);
  });
});
