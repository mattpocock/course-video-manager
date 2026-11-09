/**
 * An OPTIONAL LESSON in course.json: a Lesson a learner may skip and still
 * finish the Course carries `"optional": true` on its node, whichever member
 * it is. A required Lesson carries no key at all, so a release without an
 * Optional Lesson keeps its version 4 bytes (see course-json-v4-golden).
 */
import { describe, expect, it } from "vitest";
import { buildCourseJsonSchema, courseJsonSchemaVersion } from "../index";
import {
  makeInput,
  makeLesson,
  makeSection,
  makeVideo,
  run,
} from "./course-json-fixtures";

// One Lesson of each member, all optional. The floor is P1 so the unfilmed one
// is announced as a Placeholder Lesson.
const everyMember = (optional: boolean) =>
  makeInput(
    [
      makeSection({
        path: "01-intro",
        lessons: [
          makeLesson({
            path: "01.01-explainer",
            optional,
            videos: [makeVideo({ title: "Explainer" })],
          }),
          makeLesson({
            path: "01.02-problem",
            optional,
            videos: [
              makeVideo({ title: "Problem" }),
              makeVideo({ title: "Solution" }),
            ],
          }),
          makeLesson({
            path: "01.03-unfilmed",
            optional,
            priority: 1,
            videos: [makeVideo({ title: "Explainer", body: null })],
          }),
          makeLesson({
            path: "01.04-faq",
            optional,
            videos: [makeVideo({ title: "FAQ", clips: [] })],
          }),
        ],
      }),
    ],
    true,
    1
  );

describe("an Optional Lesson in course.json", () => {
  it('carries "optional": true on every member', async () => {
    const doc = await run(everyMember(true));
    expect(
      doc.sections[0]!.lessons.map((lesson) => [
        lesson.type,
        "optional" in lesson ? lesson.optional : "absent",
      ])
    ).toEqual([
      ["explainer", true],
      ["problem", true],
      ["placeholder", true],
      ["text", true],
    ]);
  });

  it("carries no optional key on a required lesson", async () => {
    const doc = await run(everyMember(false));
    for (const lesson of doc.sections[0]!.lessons) {
      expect(Object.keys(lesson)).not.toContain("optional");
    }
  });

  it("stamps the manifest schemaVersion 5", async () => {
    const input = makeInput([
      makeSection({
        path: "01-intro",
        lessons: [
          makeLesson({
            path: "01.01-welcome",
            optional: true,
            videos: [makeVideo({ title: "Explainer" })],
          }),
        ],
      }),
    ]);
    expect(courseJsonSchemaVersion(input)).toBe(5);
    expect((await run(input)).schemaVersion).toBe(5);
  });

  it("stays at schemaVersion 4 when the Optional Lesson is withheld", async () => {
    const input = makeInput(
      [
        makeSection({
          path: "01-intro",
          lessons: [
            makeLesson({
              path: "01.01-welcome",
              videos: [makeVideo({ title: "Explainer" })],
            }),
            makeLesson({
              path: "01.02-todo",
              optional: true,
              authoringStatus: "todo",
              videos: [makeVideo({ title: "Explainer" })],
            }),
          ],
        }),
      ],
      false
    );
    expect(courseJsonSchemaVersion(input)).toBe(4);
    const doc = await run(input);
    expect(doc.schemaVersion).toBe(4);
    expect(doc.sections[0]!.lessons).toHaveLength(1);
  });

  it("is declared, never required, on every member of the v5 sidecar only", () => {
    const members = (version: 4 | 5) =>
      JSON.parse(JSON.stringify(buildCourseJsonSchema(version))).properties
        .sections.items.properties.lessons.items.anyOf as Array<{
        properties: Record<string, unknown>;
        required: string[];
      }>;
    for (const member of members(5)) {
      expect(Object.keys(member.properties)).toContain("optional");
      expect(member.required).not.toContain("optional");
    }
    for (const member of members(4)) {
      expect(Object.keys(member.properties)).not.toContain("optional");
    }
  });
});
