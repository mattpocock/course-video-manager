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
  getSections,
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
    it("updates the title and regenerates path slug", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "Old Title");

      const result = await svc().updateLessonTitle(l.lessonId, "New Title");
      expect(result).toMatchObject({ success: true });

      const lesson = await getLessonById(l.lessonId);
      expect(lesson!.title).toBe("New Title");
      expect(lesson!.path).toBe("new-title");
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

    it("soft-deletes a real lesson and renumbers remaining", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { section, lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          { path: "01.01-first", title: "First", fsStatus: "real", order: 0 },
          { path: "01.02-second", title: "Second", fsStatus: "real", order: 1 },
          { path: "01.03-third", title: "Third", fsStatus: "real", order: 2 },
        ]
      );

      await svc().deleteLesson(lessons[1]!.id);

      const remaining = await getLessons(section.id);
      expect(remaining).toHaveLength(2);
      expect(remaining[1]!.path).toBe("01.02-third");

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

    it("reorders real lessons and renumbers paths", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { section, lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          { path: "01.01-alpha", title: "Alpha", fsStatus: "real", order: 0 },
          { path: "01.02-beta", title: "Beta", fsStatus: "real", order: 1 },
          { path: "01.03-gamma", title: "Gamma", fsStatus: "real", order: 2 },
        ]
      );

      await svc().reorderLessons(section.id, [
        lessons[2]!.id,
        lessons[1]!.id,
        lessons[0]!.id,
      ]);

      const reordered = await getLessons(section.id);
      expect(reordered.map((l) => l.title)).toEqual(["Gamma", "Beta", "Alpha"]);
      expect(reordered.map((l) => l.path)).toEqual([
        "01.01-gamma",
        "01.02-beta",
        "01.03-alpha",
      ]);
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

    it("materializes ghost target section when moving a real lesson", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-basics",
        0,
        [
          {
            path: "01.01-alpha",
            title: "Alpha",
            fsStatus: "real",
            order: 0,
          },
          {
            path: "01.02-beta",
            title: "Beta",
            fsStatus: "real",
            order: 1,
          },
        ]
      );
      // Ghost target section
      const { section: s2 } = await createSectionWithLessons(
        version.id,
        "Advanced Topics",
        1,
        []
      );

      await svc().moveLessonToSection(lessons[0]!.id, s2.id);

      // Target section should be materialized
      const sections = await getSections(version.id);
      const targetSec = sections.find((s) => s.id === s2.id);
      expect(targetSec!.path).toMatch(/^\d+-advanced-topics$/);

      // Lesson should be moved with new path
      const targetLessons = await getLessons(s2.id);
      expect(targetLessons).toHaveLength(1);
      expect(targetLessons[0]!.path).toMatch(/^\d+\.\d+-alpha$/);
    });

    it("reverts source section to ghost when last real lesson moves out", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { section: s1, lessons } = await createSectionWithLessons(
        version.id,
        "01-basics",
        0,
        [
          {
            path: "01.01-only",
            title: "Only Lesson",
            fsStatus: "real",
            order: 0,
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

      // Source section should revert to ghost title
      const sections = await getSections(version.id);
      const sourceSec = sections.find((s) => s.id === s1.id);
      expect(sourceSec!.path).toBe("Basics");
    });

    it("does NOT revert source section when other real lessons remain", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { section: s1, lessons } = await createSectionWithLessons(
        version.id,
        "01-basics",
        0,
        [
          {
            path: "01.01-alpha",
            title: "Alpha",
            fsStatus: "real",
            order: 0,
          },
          {
            path: "01.02-beta",
            title: "Beta",
            fsStatus: "real",
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

      // Source section should stay real
      const sections = await getSections(version.id);
      const sourceSec = sections.find((s) => s.id === s1.id);
      expect(sourceSec!.path).toBe("01-basics");

      // Remaining lesson should be renumbered
      const sourceLessons = await getLessons(s1.id);
      const realLessons = sourceLessons.filter((l) => l.fsStatus === "real");
      expect(realLessons[0]!.path).toBe("01.01-beta");
    });
  });

  describe("convert-to-ghost", () => {
    it("converts a real lesson to ghost", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { section, lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          { path: "01.01-lesson", title: "Lesson", fsStatus: "real", order: 0 },
          {
            path: "01.02-another",
            title: "Another",
            fsStatus: "real",
            order: 1,
          },
        ]
      );

      await svc().convertToGhost(lessons[0]!.id);

      const lesson = await getLessonById(lessons[0]!.id);
      expect(lesson!.fsStatus).toBe("ghost");

      const remaining = await getLessons(section.id);
      const realRemaining = remaining.filter((l) => l.fsStatus === "real");
      expect(realRemaining).toHaveLength(1);
      expect(realRemaining[0]!.path).toBe("01.01-another");
    });

    it("clears authoringStatus to null", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          { path: "01.01-lesson", title: "Lesson", fsStatus: "real", order: 0 },
          {
            path: "01.02-another",
            title: "Another",
            fsStatus: "real",
            order: 1,
          },
        ]
      );

      await svc().convertToGhost(lessons[0]!.id);
      const lesson = await getLessonById(lessons[0]!.id);
      expect(lesson!.authoringStatus).toBeNull();
    });

    it("rejects converting an already-ghost lesson", async () => {
      const { version } = await createCourseWithVersion();
      const s = await svc().createSection(version.id, "Section A", 0);
      const l = await svc().addGhostLesson(s.sectionId, "Ghost Lesson");
      await expect(svc().convertToGhost(l.lessonId)).rejects.toThrow();
    });
  });

  describe("set-lesson-authoring-status", () => {
    it("marks a todo lesson as done", async () => {
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
      expect((await getLessonById(result.lessonId))!.authoringStatus).toBe(
        "todo"
      );

      await svc().setLessonAuthoringStatus(result.lessonId, "done");
      expect((await getLessonById(result.lessonId))!.authoringStatus).toBe(
        "done"
      );
    });

    it("marks a done lesson back to todo", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            path: "01.01-lesson",
            title: "Lesson",
            fsStatus: "real",
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

    it("re-materialization after ghost roundtrip resets to 'todo'", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [
          {
            path: "01.01-lesson",
            title: "Lesson",
            fsStatus: "real",
            order: 0,
          },
          {
            path: "01.02-other",
            title: "Other",
            fsStatus: "real",
            order: 1,
          },
        ]
      );

      await svc().setLessonAuthoringStatus(lessons[0]!.id, "done");
      expect((await getLessonById(lessons[0]!.id))!.authoringStatus).toBe(
        "done"
      );

      await svc().convertToGhost(lessons[0]!.id);
      expect((await getLessonById(lessons[0]!.id))!.authoringStatus).toBeNull();

      await svc().createOnDisk(lessons[0]!.id);
      expect((await getLessonById(lessons[0]!.id))!.authoringStatus).toBe(
        "todo"
      );
    });
  });

  describe("create-on-disk", () => {
    it("materializes a ghost lesson to disk", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      // Section is already real because it holds a real lesson, so no section
      // materialization (cascade) should occur when the ghost lesson lands.
      const { section } = await createSectionWithLessons(
        version.id,
        "01-introduction",
        0,
        [
          {
            path: "01.01-existing",
            title: "Existing",
            fsStatus: "real",
            order: 1,
          },
        ]
      );

      const l = await svc().addGhostLesson(section.id, "My Lesson");
      const result = await svc().createOnDisk(l.lessonId);

      expect(result).toMatchObject({ success: true, path: expect.any(String) });
      // Should not include sectionPath/courseFilePath when no cascade happened
      expect(result).not.toHaveProperty("sectionId");
      expect(result).not.toHaveProperty("courseFilePath");
      const lesson = await getLessonById(l.lessonId);
      expect(lesson!.fsStatus).toBe("real");
    });

    it("returns sectionPath when ghost section is materialized", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      // Ghost section: it holds no real lessons (its path prefix is irrelevant)
      const [section] = await db()
        .insert(schema.sections)
        .values({
          repoVersionId: version.id,
          path: "Introduction",
          order: 0,
        })
        .returning();

      const l = await svc().addGhostLesson(section!.id, "First Lesson");
      const result = await svc().createOnDisk(l.lessonId);

      expect(result.sectionId).toBe(section!.id);
      expect(result.sectionPath).toMatch(/^\d+-introduction$/);
    });

    it("materializing a ghost lesson sets authoringStatus to 'todo'", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const [section] = await db()
        .insert(schema.sections)
        .values({
          repoVersionId: version.id,
          path: "01-introduction",
          order: 0,
        })
        .returning();

      const l = await svc().addGhostLesson(section!.id, "My Lesson");
      await svc().createOnDisk(l.lessonId);
      const lesson = await getLessonById(l.lessonId);
      expect(lesson!.authoringStatus).toBe("todo");
    });

    it("rejects materializing a non-ghost lesson", async () => {
      const { version } = await createCourseWithVersion("/tmp/test-repo");
      const { lessons } = await createSectionWithLessons(
        version.id,
        "01-intro",
        0,
        [{ path: "01.01-lesson", title: "Lesson", fsStatus: "real", order: 0 }]
      );
      await expect(svc().createOnDisk(lessons[0]!.id)).rejects.toThrow();
    });
  });
});
