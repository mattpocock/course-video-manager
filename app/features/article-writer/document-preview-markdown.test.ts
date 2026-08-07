import { describe, expect, it } from "vitest";
import {
  mapDocumentPreviewOffsetToSource,
  preprocessDocumentPreview,
} from "./document-preview-markdown";
import { decodeQuizPayload, QUIZ_TAG_NAME } from "./quiz-markdown";

const quiz = `<Quiz>
  <QuizQuestion data={{
    id: "only",
    question: "Which one?",
    type: "multiple-choice",
    choices: [
      { answer: "a", label: "One" },
      { answer: "b", label: "Two" }
    ],
    correct: "a",
    answer: "Because."
  }} />
</Quiz>`;

const options = { screenshots: true };

describe("preprocessDocumentPreview", () => {
  it("collapses a quiz block into one tag", () => {
    const result = preprocessDocumentPreview(`Intro.\n\n${quiz}\n`, options);
    expect(result).toContain(`<${QUIZ_TAG_NAME} payload="`);
    expect(result).not.toContain("QuizQuestion");
    expect(result).toContain("Intro.");
  });

  it("carries each question's source offset in the payload", () => {
    const source = `Intro.\n\n${quiz}\n`;
    const result = preprocessDocumentPreview(source, options);
    const payload = decodeQuizPayload(
      /payload="([^"]*)"/.exec(result)![1] as string
    );
    expect(payload.questions).toHaveLength(1);
    expect(source.slice(payload.questions[0]!.start)).toMatch(/^<QuizQuestion/);
    expect(payload.questions[0]!.problems).toEqual([]);
  });

  it("leaves an unclosed block as text", () => {
    const half = `<Quiz>\n  <QuizQuestion data={{ id: "hal`;
    expect(preprocessDocumentPreview(half, options)).toBe(half);
  });

  it("rewrites quizzes and screenshots together", () => {
    const source = `${quiz}\n\n<ChooseScreenshot clipIndex={1} alt="a" />`;
    const result = preprocessDocumentPreview(source, options);
    expect(result).toContain(`<${QUIZ_TAG_NAME} payload="`);
    expect(result).toContain("<choosescreenshot");
  });

  it("leaves screenshots alone when they are switched off", () => {
    const source = `<ChooseScreenshot clipIndex={1} alt="a" />`;
    expect(preprocessDocumentPreview(source, { screenshots: false })).toBe(
      source
    );
  });
});

describe("mapDocumentPreviewOffsetToSource", () => {
  it("maps an offset after a quiz back to the source", () => {
    const source = `${quiz}\n\nAfter the quiz.`;
    const preview = preprocessDocumentPreview(source, options);
    const previewOffset = preview.indexOf("After the quiz.");
    expect(
      mapDocumentPreviewOffsetToSource(source, previewOffset, options)
    ).toBe(source.indexOf("After the quiz."));
  });

  it("refuses an offset inside a quiz", () => {
    const source = `${quiz}\n\nAfter.`;
    const preview = preprocessDocumentPreview(source, options);
    const insideQuiz = preview.indexOf(`<${QUIZ_TAG_NAME}`) + 5;
    expect(
      mapDocumentPreviewOffsetToSource(source, insideQuiz, options)
    ).toBeUndefined();
  });

  it("maps offsets in a document with no rewrites unchanged", () => {
    expect(mapDocumentPreviewOffsetToSource("Plain text.", 6, options)).toBe(6);
  });
});
