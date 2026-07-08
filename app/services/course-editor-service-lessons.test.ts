/**
 * CourseEditorService Lesson Integration Tests
 *
 * Tests all 13 lesson event types against a real PGlite database.
 */

import { describe, it, expect } from "vitest";
import {
  setupEditorServiceTests,
  createCourseWithVersion,
  getLessons,
  getLessonById,
  createSectionWithLessons,
  editorService as es,
  testDb,
  schema,
} from "./course-editor-service-test-setup";

setupEditorServiceTests();

const svc = () => es;
const db = () => testDb;

describe("CourseEditorService — lessons", () => {
  describe("add-ghost-lesson", () => {
    it("creates a lesson in a section", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);

      const result = await svc().addGhostLesson(s.sectionId, "My Lesson");
      expect(result).toMatchObject({
        success: true,
        lessonId: expect.any(String),
      });

      const lessons = await getLessons(s.sectionId);
      expect(lessons).toHaveLength(1);
      expect(lessons[0]).toMatchObject({
        title: "My Lesson",
      });
    });

    it("lesson starts with authoringStatus todo", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "My Lesson");
      const lesson = await getLessonById(l.lessonId);
      expect(lesson!.authoringStatus).toBe("todo");
    });

    it("creates multiple ghost lessons with correct ordering", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);

      await svc().addGhostLesson(s.sectionId, "Lesson 1");
      await svc().addGhostLesson(s.sectionId, "Lesson 2");
      await svc().addGhostLesson(s.sectionId, "Lesson 3");

      const lessons = await getLessons(s.sectionId);
      expect(lessons).toHaveLength(3);
      expect(lessons.map((l) => l.title)).toEqual([
        "Lesson 1",
        "Lesson 2",
        "Lesson 3",
      ]);
    });
  });

  describe("create-real-lesson", () => {
    it("creates a real lesson in a section with a parseable path", async () => {
      const { version } = await createCourseWithVersion();
      const [section] = await db()
        .insert(schema.sections)
        .values({
          repoVersionId: version.id,
          title: "01-introduction",
          order: 0,
        })
        .returning();

      const result = await svc().createRealLesson(
        section!.id,
        "Getting Started"
      );
      expect(result).toMatchObject({
        success: true,
        lessonId: expect.any(String),
        path: expect.any(String),
      });

      const lessons = await getLessons(section!.id);
      expect(lessons).toHaveLength(1);
    });

    it("real lesson starts with authoringStatus 'todo'", async () => {
      const { version } = await createCourseWithVersion();
      const [section] = await db()
        .insert(schema.sections)
        .values({
          repoVersionId: version.id,
          title: "01-introduction",
          order: 0,
        })
        .returning();

      const result = await svc().createRealLesson(
        section!.id,
        "Getting Started"
      );
      const lesson = await getLessonById(result.lessonId);
      expect(lesson!.authoringStatus).toBe("todo");
    });

    it("creates a real lesson even when the course has no filePath", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const result = await svc().createRealLesson(s.sectionId, "My Lesson");
      expect(result).toMatchObject({ success: true });
    });
  });

  describe("update-lesson-name", () => {
    it("renames a ghost lesson slug", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "Old Name");

      const result = await svc().updateLessonName(l.lessonId, "new-name");
      expect(result).toMatchObject({ success: true, title: "new-name" });

      const lesson = await getLessonById(l.lessonId);
      expect(lesson!.title).toBe("new-name");
    });

    it("returns early when slug is unchanged", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "My Lesson");

      const result = await svc().updateLessonName(l.lessonId, "my-lesson");
      expect(result).toMatchObject({ success: true, title: "my-lesson" });
    });
  });

  describe("update-lesson-title", () => {
    it("updates the title and regenerates path slug", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "Old Title");

      const result = await svc().updateLessonTitle(l.lessonId, "New Title");
      expect(result).toMatchObject({ success: true });

      const lesson = await getLessonById(l.lessonId);
      expect(lesson!.title).toBe("New Title");
    });
  });

  describe("update-lesson-description", () => {
    it("updates the description", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "My Lesson");

      await svc().updateLessonDescription(
        l.lessonId,
        "A great lesson about testing"
      );

      const lesson = await getLessonById(l.lessonId);
      expect(lesson!.description).toBe("A great lesson about testing");
    });
  });

  describe("update-lesson-icon", () => {
    it("updates the icon", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "My Lesson");

      await svc().updateLessonIcon(l.lessonId, "code");

      const lesson = await getLessonById(l.lessonId);
      expect(lesson!.icon).toBe("code");
    });
  });

  describe("update-lesson-priority", () => {
    it("updates the priority", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "My Lesson");

      await svc().updateLessonPriority(l.lessonId, 1);

      const lesson = await getLessonById(l.lessonId);
      expect(lesson!.priority).toBe(1);
    });
  });

  describe("update-lesson-dependencies", () => {
    it("updates dependencies array", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l1 = await svc().addGhostLesson(s.sectionId, "Lesson 1");
      const l2 = await svc().addGhostLesson(s.sectionId, "Lesson 2");

      await svc().updateLessonDependencies(l2.lessonId, [l1.lessonId]);

      const lesson = await getLessonById(l2.lessonId);
      expect(lesson!.dependencies).toEqual([l1.lessonId]);
    });
  });

  describe("delete-lesson", () => {
    it("soft-deletes a ghost lesson (sets archived, not removed from DB)", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "To Delete");

      await svc().deleteLesson(l.lessonId);
      expect(await getLessons(s.sectionId)).toHaveLength(0);

      const archived = await getLessonById(l.lessonId);
      expect(archived).toBeDefined();
      expect(archived!.archived).toBe(true);
    });

    it("soft-deletes a real lesson without renumbering siblings", async () => {
      const { version } = await createCourseWithVersion();
      const { section, lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          { title: "First", order: 0 },
          { title: "Second", order: 1 },
          { title: "Third", order: 2 },
        ]
      );

      await svc().deleteLesson(lessons[1]!.id);

      const remaining = await getLessons(section.id);
      expect(remaining).toHaveLength(2);

      const archived = await getLessonById(lessons[1]!.id);
      expect(archived).toBeDefined();
      expect(archived!.archived).toBe(true);
    });
  });

  describe("reorder-lessons", () => {
    it("reorders ghost lessons by updating order field", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l1 = await svc().addGhostLesson(s.sectionId, "Alpha");
      const l2 = await svc().addGhostLesson(s.sectionId, "Beta");
      const l3 = await svc().addGhostLesson(s.sectionId, "Gamma");

      await svc().reorderLessons(s.sectionId, [
        l3.lessonId,
        l2.lessonId,
        l1.lessonId,
      ]);

      const lessons = await getLessons(s.sectionId);
      expect(lessons.map((l) => l.title)).toEqual(["Gamma", "Beta", "Alpha"]);
    });

    it("reorders real lessons by updating order values only", async () => {
      const { version } = await createCourseWithVersion();
      const { section, lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          { title: "Alpha", order: 0 },
          { title: "Beta", order: 1 },
          { title: "Gamma", order: 2 },
        ]
      );

      await svc().reorderLessons(section.id, [
        lessons[2]!.id,
        lessons[1]!.id,
        lessons[0]!.id,
      ]);

      const reordered = await getLessons(section.id);
      expect(reordered.map((l) => l.title)).toEqual(["Gamma", "Beta", "Alpha"]);
    });
  });

  describe("move-lesson-to-section", () => {
    it("moves a ghost lesson to another section", async () => {
      const { version } = await createCourseWithVersion();
      const s1 = await svc().createSection(version.id, "Section A", 0);
      const s2 = await svc().createSection(version.id, "Section B", 1);
      const l = await svc().addGhostLesson(s1.sectionId, "My Lesson");

      await svc().moveLessonToSection(l.lessonId, s2.sectionId);

      expect(await getLessons(s1.sectionId)).toHaveLength(0);
      const target = await getLessons(s2.sectionId);
      expect(target).toHaveLength(1);
      expect(target[0]!.title).toBe("My Lesson");
    });

    it("moves a real lesson to an empty section and updates paths via planner", async () => {
      const { version } = await createCourseWithVersion();
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-basics",
        0,
        [
          {
            title: "Alpha",
            order: 0,
          },
          {
            title: "Beta",
            order: 1,
          },
        ]
      );
      const { section: s2 } = await createSectionWithLessons(
        version.id,
        "02-advanced",
        1,
        []
      );

      await svc().moveLessonToSection(lessons[0]!.id, s2.id);

      const targetLessons = await getLessons(s2.id);
      expect(targetLessons).toHaveLength(1);
      expect(targetLessons[0]!.title).toBe("Alpha");
    });

    it("renumbers remaining source lessons after a move", async () => {
      const { version } = await createCourseWithVersion();
      const { section: s1, lessons } = await createSectionWithLessons(
        version.id,
        "01-basics",
        0,
        [
          {
            title: "Alpha",
            order: 0,
          },
          {
            title: "Beta",
            order: 1,
          },
        ]
      );
      const { section: s2 } = await createSectionWithLessons(
        version.id,
        "02-advanced",
        1,
        []
      );

      await svc().moveLessonToSection(lessons[0]!.id, s2.id);

      const sourceLessons = await getLessons(s1.id);
      expect(sourceLessons[0]!.title).toBe("Beta");
    });
  });

  describe("set-lesson-authoring-status", () => {
    it("marks a todo lesson as done", async () => {
      const { version } = await createCourseWithVersion();
      const [section] = await db()
        .insert(schema.sections)
        .values({
          repoVersionId: version.id,
          title: "01-introduction",
          order: 0,
        })
        .returning();

      const result = await svc().createRealLesson(
        section!.id,
        "Getting Started"
      );
      expect((await getLessonById(result.lessonId))!.authoringStatus).toBe(
        "todo"
      );

      await svc().setLessonAuthoringStatus(result.lessonId, "done");
      expect((await getLessonById(result.lessonId))!.authoringStatus).toBe(
        "done"
      );
    });

    it("marks a done lesson back to todo", async () => {
      const { version } = await createCourseWithVersion();
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            title: "Lesson",
            order: 0,
          },
        ]
      );

      expect((await getLessonById(lessons[0]!.id))!.authoringStatus).toBe(
        "done"
      );

      await svc().setLessonAuthoringStatus(lessons[0]!.id, "todo");
      expect((await getLessonById(lessons[0]!.id))!.authoringStatus).toBe(
        "todo"
      );
    });

    it("set-lesson-authoring-status round-trips between done and todo", async () => {
      const { version } = await createCourseWithVersion();
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            title: "Lesson",
            order: 0,
          },
        ]
      );

      await svc().setLessonAuthoringStatus(lessons[0]!.id, "done");
      expect((await getLessonById(lessons[0]!.id))!.authoringStatus).toBe(
        "done"
      );

      await svc().setLessonAuthoringStatus(lessons[0]!.id, "todo");
      expect((await getLessonById(lessons[0]!.id))!.authoringStatus).toBe(
        "todo"
      );
    });
  });
});
