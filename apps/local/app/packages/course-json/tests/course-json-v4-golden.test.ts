/**
 * THE V4 INVARIANT. A Course that holds no Text Lesson and no Optional Lesson
 * must publish exactly the bytes it published before either existed: the same
 * `course.json`, at `schemaVersion: 4`, beside the same `course.schema.json`.
 * The sidecar feeds the Bundle address, so it has to hold still too.
 *
 * That is what lets the CVM side merge before the site can read v5: until a
 * Course uses one of the new things, nothing the site receives changes.
 *
 * The golden values were captured from `main` before the Text Lesson and the
 * Optional Lesson existed. They are the independent source of truth here, so
 * never regenerate them with `-u` to make this test pass: a diff in either
 * is the bug this test exists to catch.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCourseJsonSchema } from "../index";
import {
  CLIPS,
  makeInput,
  makeLesson,
  makeSection,
  makeVideo,
  run,
} from "./course-json-fixtures";

// Every v4 shape at once: an explainer with Chapters, a problem with its
// solution, a problem without one, and a Placeholder Lesson.
const everyV4Shape = () =>
  makeInput(
    [
      makeSection({
        path: "01-intro",
        title: "Intro",
        lessons: [
          makeLesson({
            path: "01.01-welcome",
            title: "Welcome",
            priority: 1,
            videos: [
              makeVideo({
                title: "Explainer",
                chapters: [{ order: "a0", name: "Start" }],
              }),
            ],
          }),
          makeLesson({
            path: "01.02-unfilmed",
            title: "Unfilmed",
            priority: 1,
            videos: [makeVideo({ title: "Explainer", clips: [], body: null })],
          }),
        ],
      }),
      makeSection({
        path: "02-practice",
        title: "Practice",
        lessons: [
          makeLesson({
            path: "02.01-pair",
            title: "Pair",
            videos: [
              makeVideo({ title: "Problem", clips: CLIPS }),
              makeVideo({ title: "Solution", clips: CLIPS }),
            ],
          }),
          makeLesson({
            path: "02.02-alone",
            title: "Alone",
            videos: [makeVideo({ title: "Problem" })],
          }),
        ],
      }),
    ],
    true,
    1
  );

describe("a Course with no Text Lesson and no Optional Lesson", () => {
  it("publishes a course.json byte-identical to the v4 golden file", async () => {
    const doc = await run(everyV4Shape());
    await expect(JSON.stringify(doc, null, 2)).toMatchFileSnapshot(
      "./golden/v4-course.json"
    );
  });

  // The sidecar is ~14k tokens, too big to commit whole, so its golden value
  // is the SHA-256 and byte count of the bytes `main` wrote.
  it("publishes a course.schema.json byte-identical to the v4 golden file", () => {
    const sidecar = Buffer.from(
      JSON.stringify(buildCourseJsonSchema(4), null, 2),
      "utf-8"
    );
    expect(sidecar.byteLength).toBe(55256);
    expect(createHash("sha256").update(sidecar).digest("hex")).toBe(
      "00acb19d40ee1596846c01184c950e2183462f49d27c9f093f60232ee951b432"
    );
  });
});
