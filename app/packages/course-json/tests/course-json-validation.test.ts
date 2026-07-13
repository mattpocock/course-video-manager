import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { buildCourseJson, type BuildCourseJsonInput } from "../index";

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

describe("buildCourseJson – validation and filtering", () => {
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

  // ── Section description withheld ───────────────────────────────────

  it("omits the section description (an internal author-facing note)", async () => {
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

    expect(result.sections[0]!).not.toHaveProperty("description");
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
