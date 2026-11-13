import { describe, it, expect } from "vitest";
import {
  constrainModes,
  defaultModeForRole,
  documentToApply,
  FIELD_MODES,
} from "./writer-engine-utils";

describe("constrainModes", () => {
  it("returns the current mode if it is in the allowed list", () => {
    const result = constrainModes(["article", "article-plan"], "article");
    expect(result).toEqual({ mode: "article", isConstrained: true });
  });

  it("falls back to the first allowed mode if current is not allowed", () => {
    const result = constrainModes(["article", "article-plan"], "newsletter");
    expect(result).toEqual({ mode: "article", isConstrained: true });
  });

  it("returns current mode unconstrained when modes list is empty", () => {
    const result = constrainModes([], "newsletter");
    expect(result).toEqual({ mode: "newsletter", isConstrained: false });
  });
});

describe("FIELD_MODES", () => {
  it("only includes document modes", () => {
    const documentModes = [
      "article",
      "article-plan",
      "newsletter",
      "problem",
      "explainer",
      "solution",
      "seo-description-document",
    ];
    for (const fieldModes of Object.values(FIELD_MODES)) {
      for (const mode of fieldModes) {
        expect(documentModes).toContain(mode);
      }
    }
  });
});

describe("defaultModeForRole", () => {
  it("opens each lesson role on its own mode", () => {
    expect(defaultModeForRole("problem")).toBe("problem");
    expect(defaultModeForRole("explainer")).toBe("explainer");
    expect(defaultModeForRole("solution")).toBe("solution");
  });

  it("opens a standalone video on article", () => {
    expect(defaultModeForRole("unknown")).toBe("article");
    expect(defaultModeForRole(undefined)).toBe("article");
  });

  it("lands each role on its own mode in the lesson body modes", () => {
    for (const role of ["problem", "explainer", "solution"] as const) {
      expect(
        constrainModes(FIELD_MODES["video-body"], defaultModeForRole(role)).mode
      ).toBe(role);
    }
  });

  it("falls back to the field's first mode when the role's mode isn't offered", () => {
    expect(
      constrainModes(["article", "article-plan"], defaultModeForRole("problem"))
        .mode
    ).toBe("article");
  });
});

describe("documentToApply", () => {
  const withQuiz = `Intro.

<Quiz>
  <QuizQuestion data={{ id: "a", question: "Q?", type: "multiple-choice", choices: [{ answer: "a", label: "A" }], correct: "a", answer: "Because." }} />
</Quiz>
`;

  it("never lets a quiz through in solution mode", () => {
    expect(documentToApply("solution", withQuiz)).not.toContain("<Quiz");
  });

  it("leaves an explainer's quiz alone", () => {
    expect(documentToApply("explainer", withQuiz)).toBe(withQuiz);
  });
});
