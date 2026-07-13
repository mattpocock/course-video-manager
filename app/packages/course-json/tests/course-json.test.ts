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
      explainer: {
        body: "# Hello",
        description: "SEO text",
        hash: null,
        chapters: [],
      },
    });
    // The lesson's own description is an author-facing internal note and is
    // never emitted; only the video keeps its (user-facing) description.
    expect(lesson).not.toHaveProperty("description");
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

  // ── Relative path per video ────────────────────────────────────────

  it("sets relativePath to section-dir/lesson-dir/title.mp4 for an exportable video", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "03-concepts",
          lessons: [
            makeLesson({
              path: "03.01-models-harnesses-agents-environments",
              videos: [makeVideo({ title: "Explainer", clips: CLIPS })],
            }),
          ],
        }),
      ])
    );

    const lesson = result.sections[0]!.lessons[0]!;
    if (lesson.type === "explainer") {
      expect(lesson.explainer.relativePath).toBe(
        "03-concepts/03.01-models-harnesses-agents-environments/Explainer.mp4"
      );
    }
  });

  it("sets relativePath to null when video has no clips", async () => {
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
      expect(lesson.explainer.relativePath).toBeNull();
    }
  });

  it("uses each video's own title for the relativePath in a problem/solution pair", async () => {
    const result = await run(
      makeInput([
        makeSection({
          path: "02-exercises",
          lessons: [
            makeLesson({
              path: "02.01-exercise",
              videos: [
                makeVideo({ title: "Problem", clips: CLIPS }),
                makeVideo({ title: "Solution", clips: CLIPS }),
              ],
            }),
          ],
        }),
      ])
    );

    const lesson = result.sections[0]!.lessons[0]!;
    if (lesson.type === "problem") {
      expect(lesson.problem.relativePath).toBe(
        "02-exercises/02.01-exercise/Problem.mp4"
      );
      expect(lesson.solution!.relativePath).toBe(
        "02-exercises/02.01-exercise/Solution.mp4"
      );
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
});
