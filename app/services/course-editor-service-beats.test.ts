/**
 * CourseEditorService Beat Integration Tests
 *
 * Exercises beat events end-to-end: the service interface `send`s an event,
 * the handler routes it to the beat operation, and the change lands in a real
 * PGlite database. Focused on `update-beat-description` (the new event), which
 * must reach `setBeatDescription` and persist.
 */

import { describe, it, expect } from "vitest";
import {
  setupEditorServiceTests,
  createCourseWithVersion,
  createSectionWithLessons,
  editorService as es,
  testDb,
  schema,
} from "./course-editor-service-test-setup";

setupEditorServiceTests();

const svc = () => es;
const db = () => testDb;

async function createBeat() {
  const { version } = await createCourseWithVersion();
  const { lessons } = await createSectionWithLessons(
    version.id,
    "01-intro",
    0,
    [{ path: "01.01-lesson", title: "Lesson 1", fsStatus: "real", order: 1 }]
  );
  const [video] = await db()
    .insert(schema.videos)
    .values({
      lessonId: lessons[0]!.id,
      path: "video.mp4",
      originalFootagePath: "/tmp/video.mp4",
    })
    .returning();
  const [beat] = await db()
    .insert(schema.beats)
    .values({ videoId: video!.id, order: "a0" })
    .returning();
  return { beat: beat!, video: video! };
}

async function getBeat(id: string) {
  return db().query.beats.findFirst({
    where: (s, { eq }) => eq(s.id, id),
  });
}

describe("CourseEditorService — beats", () => {
  describe("update-beat-description", () => {
    it("routes the event to setBeatDescription and persists it", async () => {
      const { beat } = await createBeat();
      expect(beat.description).toBe("");

      const result = await svc().setBeatDescription(
        beat.id,
        "What I'll cover in this part"
      );
      expect(result).toEqual({ success: true });

      const updated = await getBeat(beat.id);
      expect(updated?.description).toBe("What I'll cover in this part");
    });

    it("clears the description back to empty", async () => {
      const { beat } = await createBeat();
      await svc().setBeatDescription(beat.id, "draft note");
      await svc().setBeatDescription(beat.id, "");

      const updated = await getBeat(beat.id);
      expect(updated?.description).toBe("");
    });
  });
});
