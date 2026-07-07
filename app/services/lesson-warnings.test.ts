import { describe, it, expect } from "vitest";
import {
  computeLessonWarnings,
  computeCourseViewLintCount,
  deriveVideoRole,
} from "./lesson-warnings";

describe("deriveVideoRole", () => {
  it("returns explainer for 'Explainer'", () => {
    expect(deriveVideoRole("Explainer")).toBe("explainer");
  });

  it("returns explainer for 'Explainer 2'", () => {
    expect(deriveVideoRole("Explainer 2")).toBe("explainer");
  });

  it("returns problem for 'Problem'", () => {
    expect(deriveVideoRole("Problem")).toBe("problem");
  });

  it("returns solution for 'Solution'", () => {
    expect(deriveVideoRole("Solution")).toBe("solution");
  });

  it("returns solution for 'Solution 2'", () => {
    expect(deriveVideoRole("Solution 2")).toBe("solution");
  });

  it("returns unknown for unrecognized paths", () => {
    expect(deriveVideoRole("Intro")).toBe("unknown");
  });
});

describe("computeLessonWarnings", () => {
  it("returns no warnings for an empty video list", () => {
    expect(computeLessonWarnings({ videos: [] })).toEqual([]);
  });

  // Valid sets
  it("returns no warnings for {explainer}", () => {
    expect(computeLessonWarnings({ videos: [{ path: "Explainer" }] })).toEqual(
      []
    );
  });

  it("returns no warnings for {problem}", () => {
    expect(computeLessonWarnings({ videos: [{ path: "Problem" }] })).toEqual(
      []
    );
  });

  it("returns no warnings for {problem, solution}", () => {
    expect(
      computeLessonWarnings({
        videos: [{ path: "Problem" }, { path: "Solution" }],
      })
    ).toEqual([]);
  });

  // Invalid: solution without problem
  it("warns on solution without problem", () => {
    const warnings = computeLessonWarnings({
      videos: [{ path: "Solution" }],
    });
    expect(warnings).toEqual([{ kind: "solutionWithoutProblem" }]);
  });

  // Invalid: explainer beside problem
  it("warns on explainer beside problem", () => {
    const warnings = computeLessonWarnings({
      videos: [{ path: "Explainer" }, { path: "Problem" }],
    });
    expect(warnings).toEqual([{ kind: "explainerBesideProblem" }]);
  });

  // Invalid: duplicate roles
  it("warns on duplicate roles", () => {
    const warnings = computeLessonWarnings({
      videos: [{ path: "Problem" }, { path: "Problem" }],
    });
    const kinds = warnings.map((w) => w.kind);
    expect(kinds).toContain("duplicateRoles");
  });

  // Invalid: 3+ videos
  it("warns on 3+ videos", () => {
    const warnings = computeLessonWarnings({
      videos: [
        { path: "Problem" },
        { path: "Solution" },
        { path: "Explainer" },
      ],
    });
    expect(warnings).toEqual([{ kind: "tooManyVideos" }]);
  });

  // Unknown roles produce no warnings (single unknown video is fine)
  it("returns no warnings for a single unknown-role video", () => {
    expect(computeLessonWarnings({ videos: [{ path: "Intro" }] })).toEqual([]);
  });

  // A lesson holds one video per role, so numbered role names are always wrong.
  it("flags 'Explainer 2' alone as a numbered role name", () => {
    expect(
      computeLessonWarnings({ videos: [{ path: "Explainer 2" }] })
    ).toEqual([{ kind: "numberedRoleName" }]);
  });

  it("flags 'Explainer 1' as a numbered role name (canonical is 'Explainer')", () => {
    expect(
      computeLessonWarnings({ videos: [{ path: "Explainer 1" }] })
    ).toContainEqual({ kind: "numberedRoleName" });
  });

  it("does not flag the bare role name 'Explainer'", () => {
    expect(computeLessonWarnings({ videos: [{ path: "Explainer" }] })).toEqual(
      []
    );
  });

  it("does not flag a numbered non-role name", () => {
    expect(
      computeLessonWarnings({ videos: [{ path: "Intro 2" }] })
    ).not.toContainEqual({ kind: "numberedRoleName" });
  });

  it("flags both numbered role name and duplicate roles for 'Explainer 1' + 'Explainer 2'", () => {
    const result = computeLessonWarnings({
      videos: [{ path: "Explainer 1" }, { path: "Explainer 2" }],
    });
    expect(result).toContainEqual({ kind: "numberedRoleName" });
    expect(result).toContainEqual({ kind: "duplicateRoles" });
  });
});

describe("computeCourseViewLintCount", () => {
  const makeVideo = (
    path: string,
    clips: { order: string; archived: boolean }[] = [],
    chapters: { order: string; archived: boolean }[] = []
  ) => ({ path, clips, chapters });

  it("returns 0 for empty sections", () => {
    expect(computeCourseViewLintCount([])).toBe(0);
  });

  it("returns 0 for a valid explainer lesson with chapters", () => {
    const sections = [
      {
        lessons: [
          {
            fsStatus: "real",
            videos: [
              makeVideo(
                "Explainer",
                [{ order: "a1", archived: false }],
                [{ order: "a0", archived: false }]
              ),
            ],
          },
        ],
      },
    ];
    expect(computeCourseViewLintCount(sections)).toBe(0);
  });

  it("counts lesson warnings for invalid role combos", () => {
    const sections = [
      {
        lessons: [
          {
            fsStatus: "real",
            videos: [makeVideo("Solution")],
          },
        ],
      },
    ];
    expect(computeCourseViewLintCount(sections)).toBeGreaterThanOrEqual(1);
  });

  it("counts video warnings for missing opening chapter", () => {
    const sections = [
      {
        lessons: [
          {
            fsStatus: "real",
            videos: [
              makeVideo("Explainer", [{ order: "a0", archived: false }], []),
            ],
          },
        ],
      },
    ];
    expect(computeCourseViewLintCount(sections)).toBe(1);
  });

  it("skips ghost lessons entirely", () => {
    const sections = [
      {
        lessons: [
          {
            fsStatus: "ghost",
            videos: [makeVideo("Solution")],
          },
        ],
      },
    ];
    expect(computeCourseViewLintCount(sections)).toBe(0);
  });

  it("sums warnings across multiple lessons and videos", () => {
    const sections = [
      {
        lessons: [
          {
            fsStatus: "real",
            videos: [makeVideo("Solution")],
          },
          {
            fsStatus: "real",
            videos: [
              makeVideo("Explainer", [{ order: "a0", archived: false }], []),
            ],
          },
        ],
      },
    ];
    expect(computeCourseViewLintCount(sections)).toBeGreaterThanOrEqual(2);
  });
});
