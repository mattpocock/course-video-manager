import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { buildCourseJson, type BuildCourseJsonInput } from "../index";
import { computeExportHash } from "@/services/export-hash";

const makeVideo = (
  overrides: Partial<
    BuildCourseJsonInput["sections"][0]["lessons"][0]["videos"][0]
  > & {
    title: string;
  }
) => ({
  lineageId: `vid-lineage-${overrides.title}`,
  body: null,
  description: null,
  archived: false,
  clips: [],
  chapters: [],
  ...overrides,
});

const makeLesson = (
  overrides: Partial<BuildCourseJsonInput["sections"][0]["lessons"][0]> & {
    path: string;
    videos: BuildCourseJsonInput["sections"][0]["lessons"][0]["videos"];
  }
) => ({
  lineageId: `lesson-lineage-${overrides.path}`,
  title: overrides.path,
  description: "",
  authoringStatus: null as string | null,
  ...overrides,
});

const makeSection = (
  overrides: Partial<BuildCourseJsonInput["sections"][0]> & {
    path: string;
    lessons: BuildCourseJsonInput["sections"][0]["lessons"];
  }
) => ({
  lineageId: `section-lineage-${overrides.path}`,
  title: overrides.title ?? overrides.path,
  description: "",
  ...overrides,
});

const makeInput = (
  sections: BuildCourseJsonInput["sections"],
  includeTodoLessons = true
): BuildCourseJsonInput => ({
  courseId: "course-1",
  courseName: "Test Course",
  sections,
  includeTodoLessons,
});

const run = (input: BuildCourseJsonInput) =>
  Effect.runPromise(buildCourseJson(input));

const CLIPS = [
  {
    videoFilename: "rec.mp4",
    sourceStartTime: 0,
    sourceEndTime: 10,
    order: "a0",
  },
  {
    videoFilename: "rec.mp4",
    sourceStartTime: 15,
    sourceEndTime: 25,
    order: "a1",
  },
];

describe("buildCourseJson", () => {
  it("emits schemaVersion 2", async () => {
    const result = await run(makeInput([]));
    expect(result.schemaVersion).toBe(2);
  });

  it("uses course id and name at the top level", async () => {
    const result = await run(
      makeInput([makeSection({ path: "01-intro", lessons: [] })])
    );
    expect(result.courseId).toBe("course-1");
    expect(result.courseName).toBe("Test Course");
  });

  it("uses lineageId as the section id", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lineageId: "sec-abc",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer" })],
            }),
          ],
        }),
      ])
    );
    expect(result.sections[0]!.id).toBe("sec-abc");
  });

  it("uses lineageId as the lesson id", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              lineageId: "lesson-abc",
              videos: [makeVideo({ title: "Explainer" })],
            }),
          ],
        }),
      ])
    );
    expect(result.sections[0]!.lessons[0]!.id).toBe("lesson-abc");
  });

  it("uses lineageId as the video id", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer", lineageId: "vid-abc" })],
            }),
          ],
        }),
      ])
    );
    const lesson = result.sections[0]!.lessons[0]!;
    expect(lesson.type).toBe("explainer");
    if (lesson.type === "explainer") {
      expect(lesson.explainer.id).toBe("vid-abc");
    }
  });

  // ── Explainer lesson ───────────────────────────────────────────────

  it("models a single Explainer video as an ExplainerLesson", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              title: "Welcome",
              description: "A welcome lesson",
              videos: [
                makeVideo({
                  title: "Explainer",
                  body: "# Hello",
                  description: "SEO text",
                }),
              ],
            }),
          ],
        }),
      ])
    );

    const lesson = result.sections[0]!.lessons[0]!;
    expect(lesson).toMatchObject({
      type: "explainer",
      title: "Welcome",
      description: "A welcome lesson",
      explainer: {
        body: "# Hello",
        description: "SEO text",
        hash: null,
        chapters: [],
      },
    });
    expect(lesson).not.toHaveProperty("path");
    if (lesson.type === "explainer") {
      expect(lesson.explainer).not.toHaveProperty("path");
    }
  });

  // ── Problem-only lesson ────────────────────────────────────────────

  it("models a single Problem video as a ProblemLesson without solution", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-exercise",
              videos: [makeVideo({ title: "Problem" })],
            }),
          ],
        }),
      ])
    );

    const lesson = result.sections[0]!.lessons[0]!;
    expect(lesson.type).toBe("problem");
    expect(lesson).not.toHaveProperty("path");
    if (lesson.type === "problem") {
      expect(lesson.problem).not.toHaveProperty("path");
      expect(lesson.solution).toBeUndefined();
    }
  });

  // ── Problem + Solution lesson ──────────────────────────────────────

  it("models Problem + Solution videos as a ProblemLesson with linked solution", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-exercise",
              videos: [
                makeVideo({ title: "Problem", lineageId: "prob-1" }),
                makeVideo({ title: "Solution", lineageId: "sol-1" }),
              ],
            }),
          ],
        }),
      ])
    );

    const lesson = result.sections[0]!.lessons[0]!;
    expect(lesson.type).toBe("problem");
    if (lesson.type === "problem") {
      expect(lesson.problem.id).toBe("prob-1");
      expect(lesson.solution).toBeDefined();
      expect(lesson.solution!.id).toBe("sol-1");
    }
  });

  // ── Unknown role → ExplainerLesson ─────────────────────────────────

  it("treats a single unknown-role video as an ExplainerLesson", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-intro",
              videos: [makeVideo({ title: "Intro" })],
            }),
          ],
        }),
      ])
    );

    const lesson = result.sections[0]!.lessons[0]!;
    expect(lesson.type).toBe("explainer");
    expect(lesson).not.toHaveProperty("path");
    if (lesson.type === "explainer") {
      expect(lesson.explainer).not.toHaveProperty("path");
    }
  });

  // ── Hash per video ─────────────────────────────────────────────────

  it("includes the content-addressed export hash per video", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer", clips: CLIPS })],
            }),
          ],
        }),
      ])
    );

    const lesson = result.sections[0]!.lessons[0]!;
    if (lesson.type === "explainer") {
      expect(lesson.explainer.hash).toBe(computeExportHash(CLIPS));
      expect(lesson.explainer.hash).not.toBeNull();
    }
  });

  it("sets hash to null when video has no clips", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer", clips: [] })],
            }),
          ],
        }),
      ])
    );

    const lesson = result.sections[0]!.lessons[0]!;
    if (lesson.type === "explainer") {
      expect(lesson.explainer.hash).toBeNull();
    }
  });

  // ── Inline chapters ────────────────────────────────────────────────

  it("includes inline chapters from clips and chapter markers", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [
                makeVideo({
                  title: "Explainer",
                  clips: [
                    {
                      videoFilename: "rec.mp4",
                      sourceStartTime: 0,
                      sourceEndTime: 20,
                      order: "a0",
                    },
                    {
                      videoFilename: "rec.mp4",
                      sourceStartTime: 25,
                      sourceEndTime: 45,
                      order: "a2",
                    },
                  ],
                  chapters: [{ order: "a1", name: "Setup" }],
                }),
              ],
            }),
          ],
        }),
      ])
    );

    const lesson = result.sections[0]!.lessons[0]!;
    if (lesson.type === "explainer") {
      expect(lesson.explainer.chapters).toEqual([
        { title: "Intro", startTime: 0 },
        { title: "Setup", startTime: 20 },
      ]);
    }
  });

  it("returns empty chapters array when video has no chapter markers", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer", clips: CLIPS })],
            }),
          ],
        }),
      ])
    );

    const lesson = result.sections[0]!.lessons[0]!;
    if (lesson.type === "explainer") {
      expect(lesson.explainer.chapters).toEqual([]);
    }
  });

  // ── Archived videos filtered ───────────────────────────────────────

  it("filters out archived videos", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [
                makeVideo({ title: "Explainer", archived: true }),
                makeVideo({ title: "Problem" }),
              ],
            }),
          ],
        }),
      ])
    );

    const lesson = result.sections[0]!.lessons[0]!;
    expect(lesson.type).toBe("problem");
  });

  it("drops a section whose only lesson has all videos archived", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer", archived: true })],
            }),
          ],
        }),
      ])
    );

    expect(result.sections).toEqual([]);
  });

  // ── Invalid combos fail loudly ─────────────────────────────────────

  it("fails on solution without problem", async () => {
    const error = await Effect.runPromise(
      buildCourseJson(
        makeInput([
          makeSection({
            path: "01-intro",
            lessons: [
              makeLesson({
                path: "01.01-exercise",
                videos: [makeVideo({ title: "Solution" })],
              }),
            ],
          }),
        ])
      ).pipe(Effect.flip)
    );
    expect(error).toMatchObject({
      _tag: "InvalidLessonRoleComboError",
      sectionPath: "01-intro",
      lessonPath: "01.01-exercise",
      videoTitles: ["Solution"],
    });
  });

  it("fails on explainer beside problem", async () => {
    const error = await Effect.runPromise(
      buildCourseJson(
        makeInput([
          makeSection({
            path: "01-intro",
            lessons: [
              makeLesson({
                path: "01.01-exercise",
                videos: [
                  makeVideo({ title: "Explainer" }),
                  makeVideo({ title: "Problem" }),
                ],
              }),
            ],
          }),
        ])
      ).pipe(Effect.flip)
    );
    expect(error).toMatchObject({
      _tag: "InvalidLessonRoleComboError",
      lessonPath: "01.01-exercise",
    });
  });

  it("fails on duplicate roles", async () => {
    const error = await Effect.runPromise(
      buildCourseJson(
        makeInput([
          makeSection({
            path: "01-intro",
            lessons: [
              makeLesson({
                path: "01.01-exercise",
                videos: [
                  makeVideo({ title: "Problem" }),
                  makeVideo({ title: "Problem" }),
                ],
              }),
            ],
          }),
        ])
      ).pipe(Effect.flip)
    );
    expect(error._tag).toBe("InvalidLessonRoleComboError");
  });

  it("fails on 3+ videos", async () => {
    const error = await Effect.runPromise(
      buildCourseJson(
        makeInput([
          makeSection({
            path: "01-intro",
            lessons: [
              makeLesson({
                path: "01.01-exercise",
                videos: [
                  makeVideo({ title: "Problem" }),
                  makeVideo({ title: "Solution" }),
                  makeVideo({ title: "Solution 2" }),
                ],
              }),
            ],
          }),
        ])
      ).pipe(Effect.flip)
    );
    expect(error._tag).toBe("InvalidLessonRoleComboError");
  });

  // ── Section description passthrough ────────────────────────────────

  it("includes section description", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          description: "Introduction section",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer" })],
            }),
          ],
        }),
      ])
    );

    expect(result.sections[0]!.description).toBe("Introduction section");
  });

  // ── Section title passthrough ──────────────────────────────────────

  it("includes faithful section title", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          title: "Introduction",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer" })],
            }),
          ],
        }),
      ])
    );

    expect(result.sections[0]!.title).toBe("Introduction");
    expect(result.sections[0]).not.toHaveProperty("path");
  });

  it("emits title on every section", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          title: "Introduction",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer" })],
            }),
          ],
        }),
        makeSection({
          path: "02-advanced",
          title: "Advanced Topics",
          lessons: [
            makeLesson({
              path: "02.01-deep",
              videos: [makeVideo({ title: "Explainer" })],
            }),
          ],
        }),
      ])
    );

    expect(result.sections[0]!.title).toBe("Introduction");
    expect(result.sections[1]!.title).toBe("Advanced Topics");
  });

  // ── Multiple sections and lessons ──────────────────────────────────

  it("handles a course with multiple sections and mixed lesson types", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer" })],
            }),
          ],
        }),
        makeSection({
          path: "02-exercises",
          lessons: [
            makeLesson({
              path: "02.01-exercise",
              videos: [
                makeVideo({ title: "Problem" }),
                makeVideo({ title: "Solution" }),
              ],
            }),
            makeLesson({
              path: "02.02-exercise",
              videos: [makeVideo({ title: "Problem" })],
            }),
          ],
        }),
      ])
    );

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]!.lessons).toHaveLength(1);
    expect(result.sections[0]!.lessons[0]!.type).toBe("explainer");
    expect(result.sections[1]!.lessons).toHaveLength(2);
    expect(result.sections[1]!.lessons[0]!.type).toBe("problem");
    expect(result.sections[1]!.lessons[1]!.type).toBe("problem");
  });

  // ── Body and description nullable ──────────────────────────────────

  it("preserves null body and description on videos", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [
                makeVideo({
                  title: "Explainer",
                  body: null,
                  description: null,
                }),
              ],
            }),
          ],
        }),
      ])
    );

    const lesson = result.sections[0]!.lessons[0]!;
    if (lesson.type === "explainer") {
      expect(lesson.explainer.body).toBeNull();
      expect(lesson.explainer.description).toBeNull();
    }
  });

  // ── Effective-output filter (includeTodoLessons) ───────────────────

  it("includes to-do lessons when includeTodoLessons is true", async () => {
    const result = await run(
      makeInput(
        [
          makeSection({
            path: "01-intro",
            lessons: [
              makeLesson({
                path: "01.01-todo",
                authoringStatus: "todo",
                videos: [makeVideo({ title: "Explainer" })],
              }),
              makeLesson({
                path: "01.02-done",
                authoringStatus: "done",
                videos: [makeVideo({ title: "Explainer" })],
              }),
            ],
          }),
        ],
        true
      )
    );
    expect(result.sections[0]!.lessons).toHaveLength(2);
  });

  it("withholds to-do lessons when includeTodoLessons is false", async () => {
    const result = await run(
      makeInput(
        [
          makeSection({
            path: "01-intro",
            title: "Intro",
            lessons: [
              makeLesson({
                path: "01.01-todo",
                title: "Todo",
                authoringStatus: "todo",
                videos: [makeVideo({ title: "Explainer" })],
              }),
              makeLesson({
                path: "01.02-done",
                title: "Done",
                authoringStatus: "done",
                videos: [makeVideo({ title: "Explainer" })],
              }),
            ],
          }),
        ],
        false
      )
    );
    expect(result.sections[0]!.lessons.map((l) => l.title)).toEqual(["Done"]);
  });

  it("drops a section whose only lessons are withheld to-do lessons", async () => {
    const result = await run(
      makeInput(
        [
          makeSection({
            path: "01-intro",
            lessons: [
              makeLesson({
                path: "01.01-todo",
                authoringStatus: "todo",
                videos: [makeVideo({ title: "Explainer" })],
              }),
            ],
          }),
        ],
        false
      )
    );
    expect(result.sections).toEqual([]);
  });

  it("never emits a section with an empty lessons array", async () => {
    const result = await run(
      makeInput([
        makeSection({ path: "01-empty", title: "Empty", lessons: [] }),
        makeSection({
          path: "02-archived",
          lessons: [
            makeLesson({
              path: "02.01-x",
              videos: [makeVideo({ title: "Explainer", archived: true })],
            }),
          ],
        }),
        makeSection({
          path: "03-real",
          lessons: [
            makeLesson({
              path: "03.01-x",
              videos: [makeVideo({ title: "Explainer" })],
            }),
          ],
        }),
      ])
    );
    expect(result.sections.map((s) => s.title)).toEqual(["03-real"]);
    for (const section of result.sections) {
      expect(section.lessons.length).toBeGreaterThan(0);
    }
  });
});
