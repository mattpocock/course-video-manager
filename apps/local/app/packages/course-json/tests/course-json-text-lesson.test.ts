/**
 * A TEXT LESSON in course.json: a Lesson whose only active Video has no Clips
 * and has a Body ships as `type: "text"`, carrying its Body and description
 * inline and no video entry, in a `schemaVersion: 5` manifest (ADR 0059).
 */
import { describe, expect, it } from "vitest";
import {
  buildCourseJsonSchema,
  courseJsonSchemaVersion,
  IncompleteShippingVideoError,
} from "../index";
import {
  makeInput,
  makeLesson,
  makeSection,
  makeVideo,
  run,
  runFlip,
} from "./course-json-fixtures";

const faq = () =>
  makeLesson({
    path: "01.02-faq",
    title: "FAQ",
    videos: [
      makeVideo({
        title: "FAQ",
        clips: [],
        body: "## Why?\n\nBecause.",
        description: "Questions about the intro",
      }),
    ],
  });

const courseWithAnFaq = () =>
  makeInput([
    makeSection({
      path: "01-intro",
      lessons: [
        makeLesson({
          path: "01.01-welcome",
          videos: [makeVideo({ title: "Explainer" })],
        }),
        faq(),
      ],
    }),
  ]);

describe("a Text Lesson in course.json", () => {
  it("ships as a text node with exactly type, id, title, body and description", async () => {
    const doc = await run(courseWithAnFaq());
    const node = doc.sections[0]!.lessons[1]!;
    expect(node).toEqual({
      type: "text",
      id: "lesson-lineage-01.02-faq",
      title: "FAQ",
      body: "## Why?\n\nBecause.",
      description: "Questions about the intro",
    });
  });

  it("needs no byte receipt, because it ships no .mp4", async () => {
    const input = courseWithAnFaq();
    const doc = await run({
      ...input,
      videoAssets: new Map(
        [...input.videoAssets].filter(([videoId]) => videoId !== "video-FAQ")
      ),
    });
    expect(doc.sections[0]!.lessons.map((lesson) => lesson.type)).toEqual([
      "explainer",
      "text",
    ]);
  });

  it("stamps the manifest schemaVersion 5", async () => {
    const doc = await run(courseWithAnFaq());
    expect(doc.schemaVersion).toBe(5);
    expect(courseJsonSchemaVersion(courseWithAnFaq())).toBe(5);
  });

  it("stays at schemaVersion 4 when the Text Lesson is withheld", async () => {
    const input = courseWithAnFaq();
    input.sections[0]!.lessons[1]!.authoringStatus = "todo";
    const withheld = { ...input, includeTodoLessons: false };
    expect(courseJsonSchemaVersion(withheld)).toBe(4);
    expect((await run(withheld)).schemaVersion).toBe(4);
  });

  it("refuses the build when the Text Lesson has no description", async () => {
    const input = courseWithAnFaq();
    input.sections[0]!.lessons[1]!.videos[0]!.description = null;
    const error = await runFlip(input);
    expect(error).toBeInstanceOf(IncompleteShippingVideoError);
    expect(error).toMatchObject({
      videoTitle: "FAQ",
      missing: ["description"],
    });
  });

  it("is described by the v5 sidecar, which the v4 sidecar never mentions", async () => {
    const lessonTypes = (version: 4 | 5) =>
      JSON.parse(
        JSON.stringify(buildCourseJsonSchema(version))
      ).properties.sections.items.properties.lessons.items.anyOf.map(
        (member: { properties: { type: { enum: string[] } } }) =>
          member.properties.type.enum[0]
      );
    expect(lessonTypes(4)).toEqual(["explainer", "problem", "placeholder"]);
    expect(lessonTypes(5)).toEqual([
      "explainer",
      "problem",
      "placeholder",
      "text",
    ]);
    const v5 = JSON.parse(JSON.stringify(buildCourseJsonSchema(5)));
    expect(v5.properties.schemaVersion.enum).toEqual([5]);
  });
});
