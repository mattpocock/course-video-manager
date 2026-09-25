import { describe, it, expect } from "vitest";
import { Effect, Schema } from "effect";
import {
  buildCourseJson,
  buildCourseJsonSchema,
  CourseJsonDocumentSchema,
  InvalidVideoAssetReceiptError,
  MissingVideoAssetReceiptError,
} from "../index";
import { computeExportHash } from "@/services/export-hash";
import {
  CLIPS,
  makeInput,
  makeLesson,
  makeSection,
  makeVideo,
  run,
} from "./course-json-fixtures";

describe("buildCourseJson", () => {
  it("emits schemaVersion 4 with the immutable Course Version id", async () => {
    const result = await run(makeInput([]));
    expect(result.schemaVersion).toBe(4);
    expect(result.courseVersionId).toBe("course-version-1");
    expect(result.archiveTTL).toBe("90d");
    expect(result.$schema).toBe(
      "versions/course-version-1-assets/course.schema.json"
    );
  });

  it("rejects a shipping video without an immutable byte receipt", async () => {
    const input = makeInput([
      makeSection({
        path: "01-intro",
        lessons: [
          makeLesson({
            path: "01.01-welcome",
            videos: [makeVideo({ title: "Explainer" })],
          }),
        ],
      }),
    ]);

    const error = await Effect.runPromise(
      buildCourseJson({ ...input, videoAssets: new Map() }).pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(MissingVideoAssetReceiptError);
    expect(error).toMatchObject({ videoId: "video-Explainer" });
  });

  it("rejects malformed byte receipts", async () => {
    const sections = [
      makeSection({
        path: "01-intro",
        lessons: [
          makeLesson({
            path: "01.01-welcome",
            videos: [makeVideo({ title: "Explainer" })],
          }),
        ],
      }),
    ];
    const input = makeInput(sections);
    const error = await Effect.runPromise(
      buildCourseJson({
        ...input,
        videoAssets: new Map([
          ["video-Explainer", { sha256: "not-a-digest", bytes: -1 }],
        ]),
      }).pipe(Effect.flip)
    );

    expect(error).toBeInstanceOf(InvalidVideoAssetReceiptError);
    expect(error).toMatchObject({ videoId: "video-Explainer" });
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
        sha256: "a".repeat(64),
        bytes: 123,
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
      expect(lesson.explainer.hash).toBe(computeExportHash(CLIPS, "landscape"));
      expect(lesson.explainer.hash).not.toBeNull();
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
        "versions/course-version-1-assets/03-concepts/03.01-models-harnesses-agents-environments/Explainer.mp4"
      );
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
        "versions/course-version-1-assets/02-exercises/02.01-exercise/Problem.mp4"
      );
      expect(lesson.solution!.relativePath).toBe(
        "versions/course-version-1-assets/02-exercises/02.01-exercise/Solution.mp4"
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
                      pauseType: "none",
                      zoomType: "none",
                      order: "a0",
                      overlays: [],
                    },
                    {
                      videoFilename: "rec.mp4",
                      sourceStartTime: 25,
                      sourceEndTime: 45,
                      pauseType: "none",
                      zoomType: "none",
                      order: "a2",
                      overlays: [],
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

  // ── Clip Mockups never ship ────────────────────────────────────────

  // A Clip Mockup is an in-app planning artifact, one rung below the Script.
  // Like a Beat and the Script it is copied forward but never reaches a
  // student. Two layers already stop it: getVersionWithSections never loads
  // the rows, and InputVideo has no field for them. This test guards the
  // second layer — if someone widens the shipped Video shape, it fails.
  it("emits no clip mockup field, and the same output as a video with none", async () => {
    const plain = makeVideo({ title: "Explainer" });
    // Attached to a variable, not an object literal, so TypeScript's excess
    // property check does not reject what the real DB row would carry.
    const withMockups = {
      ...plain,
      clipMockups: [
        {
          line: "And here is the bug.",
          imagePath: "frame-001.png",
          order: "a0",
        },
        {
          line: "One import fixes it.",
          imagePath: "frame-002.png",
          order: "a1",
        },
      ],
      beats: [{ kind: "definition", title: "Closures", order: "a0" }],
      script: "INT. TERMINAL - DAY",
    };

    const build = (video: typeof plain) =>
      run(
        makeInput([
          makeSection({
            path: "01-intro",
            lessons: [makeLesson({ path: "01.01-welcome", videos: [video] })],
          }),
        ])
      );

    const withResult = await build(withMockups);
    const withoutResult = await build(plain);

    // Byte-for-byte the same shipped Course: the Clip Mockups changed nothing.
    expect(withResult).toEqual(withoutResult);

    const lesson = withResult.sections[0]!.lessons[0]!;
    if (lesson.type === "explainer") {
      expect(lesson.explainer).not.toHaveProperty("clipMockups");
      expect(lesson.explainer).not.toHaveProperty("beats");
      expect(lesson.explainer).not.toHaveProperty("script");
      expect(Object.keys(lesson.explainer).sort()).toEqual([
        "body",
        "bytes",
        "chapters",
        "description",
        "hash",
        "id",
        "relativePath",
        "sha256",
      ]);
    }
  });
});

// ADR 0029. The Placeholder Lesson is the third member of the Lesson union: a
// title and nothing else, so a learner can read the name of a Lesson nobody has
// filmed. These state the emitted shape, because prose cannot state it exactly.
describe("buildCourseJson — Placeholder Lessons", () => {
  /** A Lesson with one hard gap (no `body`), at the given Priority band. */
  const unfilmed = (path: string, title: string, priority: number) =>
    makeLesson({
      path,
      title,
      priority,
      videos: [makeVideo({ title: "Explainer", body: null })],
    });

  it("emits type, id and title, and no other key", async () => {
    const result = await run(
      makeInput(
        [
          makeSection({
            path: "01-intro",
            lessons: [unfilmed("01.01-welcome", "Welcome", 1)],
          }),
        ],
        true,
        1
      )
    );
    // toEqual, not toMatchObject: a fourth key would be a contract change.
    expect(result.sections[0]!.lessons).toEqual([
      {
        type: "placeholder",
        id: "lesson-lineage-01.01-welcome",
        title: "Welcome",
      },
    ]);
  });

  it("keeps a shipping lesson byte-identical to what it emits today", async () => {
    const sections = [
      makeSection({
        path: "01-intro",
        lessons: [
          makeLesson({
            path: "01.01-welcome",
            videos: [makeVideo({ title: "Explainer" })],
          }),
        ],
      }),
    ];
    const announcingNothing = await run(makeInput(sections, true, null));
    const announcingEverything = await run(makeInput(sections, true, 3));
    expect(JSON.stringify(announcingEverything)).toBe(
      JSON.stringify(announcingNothing)
    );
  });

  it("ships a section whose every lesson is a placeholder", async () => {
    const result = await run(
      makeInput(
        [
          makeSection({
            path: "01-intro",
            title: "Intro",
            lessons: [unfilmed("01.01-a", "A", 1), unfilmed("01.02-b", "B", 2)],
          }),
          // Nothing effective in it at all — still elided.
          makeSection({ path: "02-empty", title: "Empty", lessons: [] }),
        ],
        true,
        2
      )
    );
    expect(result.sections.map((section) => section.title)).toEqual(["Intro"]);
    expect(result.sections[0]!.lessons.map((lesson) => lesson.type)).toEqual([
      "placeholder",
      "placeholder",
    ]);
  });

  it("emits a valid syllabus-only document with no videos in it at all", async () => {
    const result = await run(
      makeInput(
        [
          makeSection({
            path: "01-intro",
            lessons: [unfilmed("01.01-a", "A", 3)],
          }),
          makeSection({
            path: "02-deeper",
            lessons: [unfilmed("02.01-b", "B", 3)],
          }),
        ],
        true,
        3
      )
    );
    // It decodes against the published contract, and it names no .mp4.
    expect(() =>
      Schema.decodeUnknownSync(CourseJsonDocumentSchema)(result)
    ).not.toThrow();
    expect(JSON.stringify(result)).not.toContain(".mp4");
  });

  // The sidecar is `JSONSchema.make` of the very schema that types the
  // document, so they cannot drift — but the consumer reads the sidecar and not
  // our source, so this states what the consumer will find in it.
  it("generates a schema sidecar that describes the document it accompanies", async () => {
    const doc = await run(
      makeInput(
        [
          makeSection({
            path: "01-intro",
            lessons: [
              makeLesson({
                path: "01.01-filmed",
                priority: 1,
                videos: [makeVideo({ title: "Explainer" })],
              }),
              unfilmed("01.02-unfilmed", "Unfilmed", 1),
            ],
          }),
        ],
        true,
        1
      )
    );
    const sidecar = JSON.parse(JSON.stringify(buildCourseJsonSchema()));

    // The version the consumer checks first is the version we stamp.
    expect(sidecar.properties.schemaVersion.enum).toEqual([doc.schemaVersion]);

    // Three members, and every kind this document emits is one of them.
    const members =
      sidecar.properties.sections.items.properties.lessons.items.anyOf;
    const declared = members.map(
      (member: any) => member.properties.type.enum[0]
    );
    expect(declared).toEqual(["explainer", "problem", "placeholder"]);
    for (const lesson of doc.sections.flatMap((section) => section.lessons)) {
      expect(declared).toContain(lesson.type);
    }

    // The placeholder member declares exactly three keys, all required, and
    // refuses a fourth.
    const placeholder = members.find(
      (member: any) => member.properties.type.enum[0] === "placeholder"
    );
    expect(Object.keys(placeholder.properties)).toEqual([
      "type",
      "id",
      "title",
    ]);
    expect(placeholder.required).toEqual(["type", "id", "title"]);
    expect(placeholder.additionalProperties).toBe(false);
  });
});
