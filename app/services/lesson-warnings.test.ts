import { describe, it, expect } from "vitest";
import {
  computeLessonWarnings,
  computeCourseViewLintCount,
  collectCourseViewLints,
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

  it("returns unknown for unrecognized titles", () => {
    expect(deriveVideoRole("Intro")).toBe("unknown");
  });
});

describe("computeLessonWarnings", () => {
  it("returns no warnings for an empty video list", () => {
    expect(computeLessonWarnings({ videos: [] })).toEqual([]);
  });

  // Valid sets
  it("returns no warnings for {explainer}", () => {
    expect(computeLessonWarnings({ videos: [{ title: "Explainer" }] })).toEqual(
      []
    );
  });

  it("returns no warnings for {problem}", () => {
    expect(computeLessonWarnings({ videos: [{ title: "Problem" }] })).toEqual(
      []
    );
  });

  it("returns no warnings for {problem, solution}", () => {
    expect(
      computeLessonWarnings({
        videos: [{ title: "Problem" }, { title: "Solution" }],
      })
    ).toEqual([]);
  });

  // Invalid: solution without problem
  it("warns on solution without problem", () => {
    const warnings = computeLessonWarnings({
      videos: [{ title: "Solution" }],
    });
    expect(warnings).toEqual([{ kind: "solutionWithoutProblem" }]);
  });

  // Invalid: explainer beside problem
  it("warns on explainer beside problem", () => {
    const warnings = computeLessonWarnings({
      videos: [{ title: "Explainer" }, { title: "Problem" }],
    });
    expect(warnings).toEqual([{ kind: "explainerBesideProblem" }]);
  });

  // Invalid: duplicate roles
  it("warns on duplicate roles", () => {
    const warnings = computeLessonWarnings({
      videos: [{ title: "Problem" }, { title: "Problem" }],
    });
    const kinds = warnings.map((w) => w.kind);
    expect(kinds).toContain("duplicateRoles");
  });

  // Invalid: 3+ videos
  it("warns on 3+ videos", () => {
    const warnings = computeLessonWarnings({
      videos: [
        { title: "Problem" },
        { title: "Solution" },
        { title: "Explainer" },
      ],
    });
    expect(warnings).toEqual([{ kind: "tooManyVideos" }]);
  });

  // Unknown roles produce no warnings (single unknown video is fine)
  it("returns no warnings for a single unknown-role video", () => {
    expect(computeLessonWarnings({ videos: [{ title: "Intro" }] })).toEqual([]);
  });

  // A lesson holds one video per role, so numbered role names are always wrong.
  it("flags 'Explainer 2' alone as a numbered role name", () => {
    expect(
      computeLessonWarnings({ videos: [{ title: "Explainer 2" }] })
    ).toEqual([{ kind: "numberedRoleName" }]);
  });

  it("flags 'Explainer 1' as a numbered role name (canonical is 'Explainer')", () => {
    expect(
      computeLessonWarnings({ videos: [{ title: "Explainer 1" }] })
    ).toContainEqual({ kind: "numberedRoleName" });
  });

  it("does not flag the bare role name 'Explainer'", () => {
    expect(computeLessonWarnings({ videos: [{ title: "Explainer" }] })).toEqual(
      []
    );
  });

  it("does not flag a numbered non-role name", () => {
    expect(
      computeLessonWarnings({ videos: [{ title: "Intro 2" }] })
    ).not.toContainEqual({ kind: "numberedRoleName" });
  });

  it("flags both numbered role name and duplicate roles for 'Explainer 1' + 'Explainer 2'", () => {
    const result = computeLessonWarnings({
      videos: [{ title: "Explainer 1" }, { title: "Explainer 2" }],
    });
    expect(result).toContainEqual({ kind: "numberedRoleName" });
    expect(result).toContainEqual({ kind: "duplicateRoles" });
  });
});

describe("computeCourseViewLintCount", () => {
  const makeVideo = (
    title: string,
    clips: { order: string; archived: boolean }[] = [],
    chapters: { order: string; archived: boolean }[] = []
  ) => ({ title, clips, chapters });

  it("returns 0 for empty sections", () => {
    expect(computeCourseViewLintCount([])).toBe(0);
  });

  it("returns 0 for a valid explainer lesson with chapters", () => {
    const sections = [
      {
        lessons: [
          {
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
            videos: [makeVideo("Solution")],
          },
        ],
      },
    ];
    expect(computeCourseViewLintCount(sections)).toBeGreaterThanOrEqual(1);
  });

  it("counts video warnings for missing chapters", () => {
    const sections = [
      {
        lessons: [
          {
            videos: [
              makeVideo("Explainer", [{ order: "a0", archived: false }], []),
            ],
          },
        ],
      },
    ];
    expect(computeCourseViewLintCount(sections)).toBe(1);
  });

  it("sums warnings across multiple lessons and videos", () => {
    const sections = [
      {
        lessons: [
          {
            videos: [makeVideo("Solution")],
          },
          {
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

describe("collectCourseViewLints", () => {
  const makeVideo = (
    title: string,
    clips: { order: string; archived: boolean }[] = [],
    chapters: { order: string; archived: boolean }[] = []
  ) => ({ title, clips, chapters });

  it("count is exactly the number of itemised lints", () => {
    const sections = [
      {
        path: "01-intro",
        lessons: [
          { path: "01-a", videos: [makeVideo("Solution")] },
          {
            path: "02-b",
            videos: [
              makeVideo("Explainer", [{ order: "a0", archived: false }], []),
            ],
          },
        ],
      },
    ];
    expect(collectCourseViewLints(sections)).toHaveLength(
      computeCourseViewLintCount(sections)
    );
  });

  it("tags a lesson-level lint with its section and lesson path", () => {
    const lints = collectCourseViewLints([
      {
        path: "01-intro",
        lessons: [{ path: "01-a", videos: [makeVideo("Solution")] }],
      },
    ]);
    expect(lints).toContainEqual({
      scope: "lesson",
      sectionPath: "01-intro",
      lessonPath: "01-a",
      kind: "solutionWithoutProblem",
    });
  });

  it("excludes archived videos from lesson warnings", () => {
    // Three live videos would trip the "too many videos" lesson warning, but two
    // of them are archived — so the lesson has one active video and no warning.
    const sections = [
      {
        path: "01-intro",
        lessons: [
          {
            path: "01-a",
            videos: [
              { ...makeVideo("Explainer"), archived: false },
              { ...makeVideo("Problem"), archived: true },
              { ...makeVideo("Solution"), archived: true },
            ],
          },
        ],
      },
    ];
    expect(
      collectCourseViewLints(sections).filter((l) => l.scope === "lesson")
    ).toEqual([]);
  });

  it("excludes archived videos from video warnings", () => {
    // The archived video has no chapters, but archived videos are never
    // published, so it must not raise a warning.
    const sections = [
      {
        path: "01-intro",
        lessons: [
          {
            path: "01-a",
            videos: [
              {
                ...makeVideo(
                  "Explainer",
                  [{ order: "a0", archived: false }],
                  []
                ),
                archived: true,
              },
            ],
          },
        ],
      },
    ];
    expect(collectCourseViewLints(sections)).toEqual([]);
  });

  it("tags a video-level lint with the offending video title", () => {
    const lints = collectCourseViewLints([
      {
        path: "01-intro",
        lessons: [
          {
            path: "01-a",
            videos: [
              makeVideo("Explainer", [{ order: "a0", archived: false }], []),
            ],
          },
        ],
      },
    ]);
    expect(lints).toContainEqual({
      scope: "video",
      sectionPath: "01-intro",
      lessonPath: "01-a",
      videoTitle: "Explainer",
      kind: "missingChapters",
    });
  });
});
