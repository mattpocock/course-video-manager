import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { buildCourseJson, collectPublishBlockers } from "../index";
import {
  makeInput,
  makeLesson,
  makeSection,
  makeVideo,
  run,
  runFlip,
} from "./course-json-fixtures";

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

  // ── A hard gap decides a status rather than failing ────────────────
  //
  // ADR 0029: `IncompleteVideosError` is gone. A Video with no Clips or no
  // `body` is a HARD GAP — a gap Autofill cannot close — so it decides the
  // Lesson's Lesson Publish Status instead of stopping the release. A missing
  // `description` is the one gap that still stops it; see below.

  const gappedCourse = (
    overrides: Partial<{ clips: never[]; body: null }>,
    priority = 2
  ) => [
    makeSection({
      path: "01-intro",
      lessons: [
        makeLesson({
          path: "01.01-welcome",
          priority,
          title: "Welcome",
          videos: [makeVideo({ title: "Explainer", ...overrides })],
        }),
      ],
    }),
  ];

  it("withholds a lesson whose video has no exportable clips", async () => {
    const result = await run(makeInput(gappedCourse({ clips: [] })));
    expect(result.sections).toEqual([]);
  });

  it("withholds a lesson whose video has no body", async () => {
    const result = await run(makeInput(gappedCourse({ body: null })));
    expect(result.sections).toEqual([]);
  });

  it("announces a gapped lesson once the floor reaches its priority", async () => {
    const withheld = await run(
      makeInput(gappedCourse({ body: null }, 3), true, 2)
    );
    expect(withheld.sections).toEqual([]);

    const announced = await run(
      makeInput(gappedCourse({ body: null }, 3), true, 3)
    );
    expect(announced.sections[0]!.lessons).toEqual([
      {
        type: "placeholder",
        id: "lesson-lineage-01.01-welcome",
        title: "Welcome",
      },
    ]);
  });

  // A missing `description` is NOT a hard gap: Autofill writes it, so a Lesson
  // one press from complete is never ANNOUNCED as a Placeholder Lesson. Which
  // leaves exactly one honest outcome — the release is refused. The schema types
  // `description` as a string, and no floor position can turn this Lesson into a
  // node that omits it.
  //
  // THIS GATE IS THE NO-NULL GUARANTEE (ADR 0019, ADR 0029). It lives inside the
  // builder, so it holds on EVERY path into a manifest — including the
  // standalone Dropbox re-sync, which runs no lint gate and would otherwise
  // overwrite a live course.json with `"description": null`.
  const missingDescriptionCourse = (description: string | null) => [
    makeSection({
      path: "01-intro",
      lessons: [
        makeLesson({
          path: "01.01-welcome",
          videos: [makeVideo({ title: "Explainer", description })],
        }),
      ],
    }),
  ];

  it.each([
    ["absent", null],
    ["blank", "  "],
  ] as const)(
    "refuses a release when a shipping video's description is %s",
    async (_name, description) => {
      const error = await runFlip(
        makeInput(missingDescriptionCourse(description))
      );
      expect(error).toMatchObject({
        _tag: "IncompleteShippingVideoError",
        sectionPath: "01-intro",
        lessonPath: "01.01-welcome",
        videoTitle: "Explainer",
        missing: ["description"],
      });
    }
  );

  // …and the floor cannot talk its way past it either: the Lesson is shippable
  // in the classifier's eyes, so no band makes it a Placeholder Lesson.
  it("refuses it at every floor position", async () => {
    for (const floor of [null, 1, 2, 3] as const) {
      const error = await runFlip(
        makeInput(missingDescriptionCourse(null), true, floor)
      );
      expect(error._tag).toBe("IncompleteShippingVideoError");
    }
  });

  // The one release-stopping failure left: an ambiguous role combo. There is no
  // honest node to emit for it, so it is not a status — it is a refusal.
  it("still refuses a release when a shipping lesson's roles are ambiguous", async () => {
    const error = await runFlip(
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
    );
    expect(error).toMatchObject({
      _tag: "InvalidLessonRoleComboError",
      lessonPath: "01.01-exercise",
    });
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

// The pre-publish page reads collectPublishBlockers to warn and block before a
// doomed publish; buildCourseJson reads the same result as its backstop. The
// walk is the SHIPPING output (ADR 0029): a Lesson that is withheld or merely
// announced is silent here, because a half-planned Video must not refuse a
// pre-launch release.
describe("collectPublishBlockers", () => {
  it("returns no blockers for a complete course", () => {
    const blockers = collectPublishBlockers(
      [
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer" })],
            }),
          ],
        }),
      ],
      true
    );
    expect(blockers).toEqual({
      invalidLessonCombos: [],
      incompleteVideos: [],
    });
  });

  it("collects every incomplete shipping video across the course", () => {
    const blockers = collectPublishBlockers(
      [
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer", description: null })],
            }),
          ],
        }),
        makeSection({
          path: "02-exercises",
          lessons: [
            makeLesson({
              path: "02.01-exercise",
              videos: [makeVideo({ title: "Problem", description: null })],
            }),
          ],
        }),
      ],
      true
    );
    expect(blockers.invalidLessonCombos).toEqual([]);
    expect(blockers.incompleteVideos).toEqual([
      {
        sectionPath: "01-intro",
        lessonPath: "01.01-welcome",
        videoTitle: "Explainer",
        missing: ["description"],
      },
      {
        sectionPath: "02-exercises",
        lessonPath: "02.01-exercise",
        videoTitle: "Problem",
        missing: ["description"],
      },
    ]);
  });

  // A hard gap stops the Lesson shipping, so there is nothing here to report.
  // The Lesson appears as its Lesson Publish Status instead.
  it("says nothing about a lesson a hard gap stops shipping", () => {
    const blockers = collectPublishBlockers(
      [
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer", clips: [] })],
            }),
            makeLesson({
              path: "01.02-next",
              videos: [makeVideo({ title: "Explainer", body: null })],
            }),
          ],
        }),
      ],
      true
    );
    expect(blockers).toEqual({
      invalidLessonCombos: [],
      incompleteVideos: [],
    });
  });

  it("collects every invalid lesson combo", () => {
    const blockers = collectPublishBlockers(
      [
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-exercise",
              videos: [makeVideo({ title: "Solution" })],
            }),
            makeLesson({
              path: "01.02-exercise",
              videos: [
                makeVideo({ title: "Explainer" }),
                makeVideo({ title: "Problem" }),
              ],
            }),
          ],
        }),
      ],
      true
    );
    expect(blockers.incompleteVideos).toEqual([]);
    expect(blockers.invalidLessonCombos).toMatchObject([
      { lessonPath: "01.01-exercise", videoTitles: ["Solution"] },
      {
        lessonPath: "01.02-exercise",
        videoTitles: ["Explainer", "Problem"],
      },
    ]);
  });

  it("does not gap-check a lesson with an invalid combo (roles are ambiguous)", () => {
    const blockers = collectPublishBlockers(
      [
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-exercise",
              // Invalid combo AND both videos incomplete — only the combo is
              // reported, since we can't say which video plays which role.
              videos: [
                makeVideo({ title: "Explainer", description: null }),
                makeVideo({ title: "Problem", description: null }),
              ],
            }),
          ],
        }),
      ],
      true
    );
    expect(blockers.incompleteVideos).toEqual([]);
    expect(blockers.invalidLessonCombos).toHaveLength(1);
  });

  it("ignores withheld to-do lessons", () => {
    const sections = [
      makeSection({
        path: "01-intro",
        lessons: [
          makeLesson({
            path: "01.01-todo",
            authoringStatus: "todo",
            videos: [makeVideo({ title: "Explainer", description: null })],
          }),
        ],
      }),
    ];
    // Included → the incomplete to-do video is a blocker.
    expect(
      collectPublishBlockers(sections, true).incompleteVideos
    ).toHaveLength(1);
    // Withheld → it doesn't ship, so it isn't a blocker.
    expect(
      collectPublishBlockers(sections, false).incompleteVideos
    ).toHaveLength(0);
  });

  it("ignores archived videos", () => {
    const blockers = collectPublishBlockers(
      [
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [
                makeVideo({ title: "Old", archived: true, description: null }),
                makeVideo({ title: "Explainer" }),
              ],
            }),
          ],
        }),
      ],
      true
    );
    expect(blockers).toEqual({
      invalidLessonCombos: [],
      incompleteVideos: [],
    });
  });
});
