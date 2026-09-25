import { describe, expect, it } from "vitest";
import { countCourseWarnings } from "./course-warning-count";

describe("countCourseWarnings", () => {
  it("counts every kind of triangle the tree draws", () => {
    // The reported symptom: a Section with four Learning Goals no Beat serves,
    // and one Beat serving none of them, drew five amber triangles while the
    // header badge read zero.
    const count = countCourseWarnings([
      {
        learningGoals: [
          { warnings: [{ kind: "noBeats" }] },
          { warnings: [{ kind: "noBeats" }] },
          { warnings: [{ kind: "noBeats" }] },
          { warnings: [{ kind: "noBeats" }] },
        ],
        lessons: [
          {
            lessonWarnings: [{ kind: "missingBody" }],
            videos: [
              {
                warnings: [{ kind: "duplicateQuizId" }],
                beats: [{ warnings: [{ kind: "noLearningGoal" }] }],
              },
            ],
          },
        ],
      },
    ]);

    expect(count).toBe(7);
  });

  it("is zero for a Section whose tree is clean", () => {
    expect(
      countCourseWarnings([
        {
          learningGoals: [{ warnings: [] }],
          lessons: [
            {
              lessonWarnings: [],
              videos: [{ warnings: [], beats: [{ warnings: [] }] }],
            },
          ],
        },
      ])
    ).toBe(0);
  });
});
