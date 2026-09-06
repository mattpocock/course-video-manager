import { describe, it, expect } from "vitest";
import {
  computeBeatWarnings,
  computeLearningGoalWarnings,
  sectionHasLearningGoals,
} from "./beat-learning-goal-warnings";

describe("sectionHasLearningGoals", () => {
  it("is false for a section with no learning goals", () => {
    expect(sectionHasLearningGoals([])).toBe(false);
  });

  it("is true once a section has at least one learning goal", () => {
    expect(sectionHasLearningGoals([{ id: "goal-1" }])).toBe(true);
  });
});

describe("computeLearningGoalWarnings", () => {
  it("warns when no beat in the section serves the goal", () => {
    expect(
      computeLearningGoalWarnings({
        learningGoalId: "goal-1",
        beats: [{ learningGoalIds: [] }, { learningGoalIds: ["goal-2"] }],
      })
    ).toEqual([{ kind: "noBeats" }]);
  });

  it("does not warn once any beat serves the goal", () => {
    expect(
      computeLearningGoalWarnings({
        learningGoalId: "goal-1",
        beats: [
          { learningGoalIds: ["goal-2"] },
          { learningGoalIds: ["goal-1", "goal-2"] },
        ],
      })
    ).toEqual([]);
  });

  it("does not warn when no beats exist yet", () => {
    expect(
      computeLearningGoalWarnings({ learningGoalId: "goal-1", beats: [] })
    ).toEqual([{ kind: "noBeats" }]);
  });
});

describe("computeBeatWarnings", () => {
  it("never warns when the section has no learning goals", () => {
    expect(
      computeBeatWarnings({
        sectionHasLearningGoals: false,
        learningGoalIds: [],
      })
    ).toEqual([]);
  });

  it("warns when the section has learning goals and the beat serves none", () => {
    expect(
      computeBeatWarnings({
        sectionHasLearningGoals: true,
        learningGoalIds: [],
      })
    ).toEqual([{ kind: "noLearningGoal" }]);
  });

  it("does not warn once the beat serves at least one learning goal", () => {
    expect(
      computeBeatWarnings({
        sectionHasLearningGoals: true,
        learningGoalIds: ["goal-1"],
      })
    ).toEqual([]);
  });
});
