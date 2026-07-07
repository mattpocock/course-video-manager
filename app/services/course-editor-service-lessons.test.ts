/**
 * CourseEditorService Lesson Integration Tests — create & update
 *
 * Write-heavy operations (delete, reorder, move, convert, create-on-disk)
 * live in course-editor-service-lessons-write.test.ts.
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
    it("creates a ghost lesson in a section", async () => {
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
        path: "my-lesson",
        fsStatus: "ghost",
      });
    });

    it("ghost lesson has null authoringStatus", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "My Lesson");
      const lesson = await getLessonById(l.lessonId);
      expect(lesson!.authoringStatus).toBeNull();
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
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const [section] = await db()
        .insert(schema.sections)
        .values({
          repoVersionId: version.id,
          path: "01-introduction",
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
      expect(lessons[0]!.fsStatus).toBe("real");
    });

    it("real lesson starts with authoringStatus 'todo'", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const [section] = await db()
        .insert(schema.sections)
        .values({
          repoVersionId: version.id,
          path: "01-introduction",
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

    it("rejects creating a real lesson in a ghost course", async () => {
      const { version } = await createCourseWithVersion(null);
      const s = await svc().createSection(version.id, "Section A", 0);
      await expect(
        svc().createRealLesson(s.sectionId, "My Lesson")
      ).rejects.toThrow();
    });
  });

  describe("update-lesson-name", () => {
    it("renames a ghost lesson slug", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "Old Name");

      const result = await svc().updateLessonName(l.lessonId, "new-name");
      expect(result).toMatchObject({ success: true, path: "new-name" });

      const lesson = await getLessonById(l.lessonId);
      expect(lesson!.path).toBe("new-name");
    });

    it("returns early when slug is unchanged", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "My Lesson");

      const result = await svc().updateLessonName(l.lessonId, "my-lesson");
      expect(result).toMatchObject({ success: true, path: "my-lesson" });
    });
  });

  describe("update-lesson-title", () => {
    it("retitles a ghost lesson: updates title and path slug", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "Old Title");

      const result = await svc().updateLessonTitle(l.lessonId, "New Title");
      expect(result).toMatchObject({ success: true });

      const lesson = await getLessonById(l.lessonId);
      expect(lesson!.title).toBe("New Title");
      expect(lesson!.path).toBe("new-title");
    });

    it("retitles a real lesson: updates title and git mvs to derived path", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            path: "01.01-old-name",
            title: "Old Name",
            fsStatus: "real",
            order: 0,
          },
        ]
      );

      const result = await svc().updateLessonTitle(lessons[0]!.id, "New Name");
      expect(result).toMatchObject({ success: true });

      const lesson = await getLessonById(lessons[0]!.id);
      expect(lesson!.title).toBe("New Name");
      expect(lesson!.path).toBe("01.01-new-name");
    });

    it("retitling a real lesson preserves lesson number", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          { path: "01.01-first", title: "First", fsStatus: "real", order: 0 },
          { path: "01.02-second", title: "Second", fsStatus: "real", order: 1 },
        ]
      );

      await svc().updateLessonTitle(lessons[1]!.id, "Updated Second");

      const lesson = await getLessonById(lessons[1]!.id);
      expect(lesson!.title).toBe("Updated Second");
      expect(lesson!.path).toBe("01.02-updated-second");
    });

    it("no-ops when title slugifies to the same slug", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            path: "01.01-my-lesson",
            title: "My Lesson",
            fsStatus: "real",
            order: 0,
          },
        ]
      );

      const result = await svc().updateLessonTitle(lessons[0]!.id, "My Lesson");
      expect(result).toMatchObject({ success: true });

      const lesson = await getLessonById(lessons[0]!.id);
      expect(lesson!.path).toBe("01.01-my-lesson");
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
});
