import { describe, expect, it } from "vitest";
import {
  collectCourseQuizIdUses,
  findQuizIdCollisions,
  nextFreeQuizId,
  renameCollidingQuizIds,
} from "./quiz-ids";
import { collectQuizIds } from "./quiz-syntax";
import { findTakenQuizIds, maskQuizNonProse } from "./quiz-lint";

const question = (id: string) => `  <QuizQuestion data={{
    id: "${id}",
    question: "Which one?",
    type: "multiple-choice",
    choices: [
      { answer: "a", label: "Option one" },
      { answer: "b", label: "Option two" }
    ],
    correct: "a",
    answer: "Because."
  }} />`;

const quiz = (...ids: string[]) =>
  `<Quiz>\n${ids.map(question).join("\n")}\n</Quiz>`;

describe("collectCourseQuizIdUses", () => {
  it("names the video each id came from", () => {
    expect(
      collectCourseQuizIdUses([
        { videoId: "v1", videoTitle: "Explainer", body: quiz("a") },
        { videoId: "v2", videoTitle: "Problem", body: null },
      ])
    ).toEqual([{ id: "a", videoId: "v1", videoTitle: "Explainer" }]);
  });
});

describe("findQuizIdCollisions", () => {
  it("reports an id two videos share, naming both", () => {
    const collisions = findQuizIdCollisions(
      collectCourseQuizIdUses([
        { videoId: "v1", videoTitle: "One", body: quiz("shared") },
        { videoId: "v2", videoTitle: "Two", body: quiz("shared") },
      ])
    );
    expect(collisions).toHaveLength(1);
    expect(collisions[0]!.id).toBe("shared");
    expect(collisions[0]!.uses.map((use) => use.videoTitle)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("reports an id one body repeats", () => {
    expect(
      findQuizIdCollisions(
        collectCourseQuizIdUses([
          { videoId: "v1", videoTitle: "One", body: quiz("twice", "twice") },
        ])
      )
    ).toHaveLength(1);
  });

  it("says nothing when every id is unique", () => {
    expect(
      findQuizIdCollisions(
        collectCourseQuizIdUses([
          { videoId: "v1", videoTitle: "One", body: quiz("a", "b") },
          { videoId: "v2", videoTitle: "Two", body: quiz("c") },
        ])
      )
    ).toEqual([]);
  });
});

describe("nextFreeQuizId", () => {
  it("suffixes a taken id", () => {
    expect(nextFreeQuizId("subagents", new Set(["subagents"]))).toBe(
      "subagents-2"
    );
  });

  it("walks past a taken suffix", () => {
    expect(
      nextFreeQuizId("subagents", new Set(["subagents", "subagents-2"]))
    ).toBe("subagents-3");
  });

  it("counts on from an already-suffixed id rather than stacking", () => {
    expect(nextFreeQuizId("subagents-2", new Set(["subagents-2"]))).toBe(
      "subagents-3"
    );
  });
});

describe("renameCollidingQuizIds", () => {
  it("renames only the id the course already owns", () => {
    const body = quiz("taken", "free");
    expect(collectQuizIds(renameCollidingQuizIds(body, ["taken"]))).toEqual([
      "taken-2",
      "free",
    ]);
  });

  it("keeps the first use and renames the repeat", () => {
    expect(
      collectQuizIds(renameCollidingQuizIds(quiz("dup", "dup"), []))
    ).toEqual(["dup", "dup-2"]);
  });

  it("leaves a clean document untouched", () => {
    const body = quiz("a", "b");
    expect(renameCollidingQuizIds(body, ["c"])).toBe(body);
  });
});

describe("findTakenQuizIds", () => {
  it("finds an id another video owns", () => {
    expect(findTakenQuizIds(quiz("taken"), ["taken"])).toEqual(["taken"]);
  });

  it("finds an id the document repeats", () => {
    expect(findTakenQuizIds(quiz("dup", "dup"), [])).toEqual(["dup"]);
  });

  it("passes a clean document", () => {
    expect(findTakenQuizIds(quiz("a"), ["b"])).toEqual([]);
  });
});

describe("maskQuizNonProse", () => {
  const body = `Some prose.\n\n${quiz("em-dash-id")}\n\nMore prose.`;

  it("keeps the question and the explanation", () => {
    const masked = maskQuizNonProse(body);
    expect(masked).toContain("Which one?");
    expect(masked).toContain("Because.");
  });

  it("hides the id and the JSX around it", () => {
    const masked = maskQuizNonProse(body);
    expect(masked).not.toContain("em-dash-id");
    expect(masked).not.toContain("QuizQuestion");
    expect(masked).not.toContain("multiple-choice");
  });

  it("leaves the prose around the quiz alone", () => {
    const masked = maskQuizNonProse(body);
    expect(masked).toContain("Some prose.");
    expect(masked).toContain("More prose.");
  });

  it("returns a quiz-free document unchanged", () => {
    expect(maskQuizNonProse("Just prose.")).toBe("Just prose.");
  });
});
