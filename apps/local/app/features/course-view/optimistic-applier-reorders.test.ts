import { describe, it, expect } from "vitest";
import { applyOptimisticEvent } from "./optimistic-applier";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import {
  makeLesson,
  makeSection,
  makeLoaderData,
} from "./optimistic-applier-test-helpers";

describe("applyOptimisticEvent — reorders", () => {
  describe("reorder-sections", () => {
    it("reorders sections to match the given sectionIds order", () => {
      const section1 = makeSection({ id: "s1" });
      const section2 = makeSection({ id: "s2" }, [
        makeLesson({ id: "lesson-2" }),
      ]);
      const section3 = makeSection({ id: "s3" }, [
        makeLesson({ id: "lesson-3" }),
      ]);
      const loaderData = makeLoaderData([section1, section2, section3]);

      const event: CourseEditorEvent = {
        type: "reorder-sections",
        sectionIds: ["s3", "s1", "s2"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections.map((s) => s.id)).toEqual([
        "s3",
        "s1",
        "s2",
      ]);
    });

    it("does not mutate the original loaderData", () => {
      const section1 = makeSection({ id: "s1" });
      const section2 = makeSection({ id: "s2" }, [
        makeLesson({ id: "lesson-2" }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "reorder-sections",
        sectionIds: ["s2", "s1"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).not.toBe(loaderData);
      expect(loaderData.selectedCourse!.sections.map((s) => s.id)).toEqual([
        "s1",
        "s2",
      ]);
    });

    it("preserves section object references", () => {
      const section1 = makeSection({ id: "s1" });
      const section2 = makeSection({ id: "s2" }, [
        makeLesson({ id: "lesson-2" }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "reorder-sections",
        sectionIds: ["s2", "s1"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]).toBe(section2);
      expect(result.selectedCourse!.sections[1]).toBe(section1);
    });

    it("returns loaderData unchanged when order is the same", () => {
      const section1 = makeSection({ id: "s1" });
      const section2 = makeSection({ id: "s2" }, [
        makeLesson({ id: "lesson-2" }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "reorder-sections",
        sectionIds: ["s1", "s2"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("returns loaderData unchanged with empty sectionIds", () => {
      const loaderData = makeLoaderData([makeSection({ id: "s1" })]);

      const event: CourseEditorEvent = {
        type: "reorder-sections",
        sectionIds: [],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("appends sections not in sectionIds at the end", () => {
      const section1 = makeSection({ id: "s1" });
      const section2 = makeSection({ id: "s2" }, [
        makeLesson({ id: "lesson-2" }),
      ]);
      const section3 = makeSection({ id: "s3" }, [
        makeLesson({ id: "lesson-3" }),
      ]);
      const loaderData = makeLoaderData([section1, section2, section3]);

      const event: CourseEditorEvent = {
        type: "reorder-sections",
        sectionIds: ["s3", "s1"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections.map((s) => s.id)).toEqual([
        "s3",
        "s1",
        "s2",
      ]);
    });
  });

  describe("reorder-lessons", () => {
    it("reorders lessons within the target section", () => {
      const lesson1 = makeLesson({ id: "l1" });
      const lesson2 = makeLesson({ id: "l2" });
      const lesson3 = makeLesson({ id: "l3" });
      const section = makeSection({ id: "s1" }, [lesson1, lesson2, lesson3]);
      const loaderData = makeLoaderData([section]);

      const event: CourseEditorEvent = {
        type: "reorder-lessons",
        sectionId: "s1",
        lessonIds: ["l3", "l1", "l2"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(
        result.selectedCourse!.sections[0]!.lessons.map((l) => l.id)
      ).toEqual(["l3", "l1", "l2"]);
    });

    it("does not mutate the original loaderData", () => {
      const lesson1 = makeLesson({ id: "l1" });
      const lesson2 = makeLesson({ id: "l2" });
      const section = makeSection({ id: "s1" }, [lesson1, lesson2]);
      const loaderData = makeLoaderData([section]);

      const event: CourseEditorEvent = {
        type: "reorder-lessons",
        sectionId: "s1",
        lessonIds: ["l2", "l1"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).not.toBe(loaderData);
      expect(
        loaderData.selectedCourse!.sections[0]!.lessons.map((l) => l.id)
      ).toEqual(["l1", "l2"]);
    });

    it("preserves lesson object references", () => {
      const lesson1 = makeLesson({ id: "l1" });
      const lesson2 = makeLesson({ id: "l2" });
      const section = makeSection({ id: "s1" }, [lesson1, lesson2]);
      const loaderData = makeLoaderData([section]);

      const event: CourseEditorEvent = {
        type: "reorder-lessons",
        sectionId: "s1",
        lessonIds: ["l2", "l1"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.lessons[0]).toBe(lesson2);
      expect(result.selectedCourse!.sections[0]!.lessons[1]).toBe(lesson1);
    });

    it("returns loaderData unchanged when section is not found", () => {
      const loaderData = makeLoaderData([makeSection({ id: "s1" })]);

      const event: CourseEditorEvent = {
        type: "reorder-lessons",
        sectionId: "nonexistent",
        lessonIds: ["l1"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("returns loaderData unchanged when order is the same", () => {
      const lesson1 = makeLesson({ id: "l1" });
      const lesson2 = makeLesson({ id: "l2" });
      const section = makeSection({ id: "s1" }, [lesson1, lesson2]);
      const loaderData = makeLoaderData([section]);

      const event: CourseEditorEvent = {
        type: "reorder-lessons",
        sectionId: "s1",
        lessonIds: ["l1", "l2"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("does not affect other sections", () => {
      const section1 = makeSection({ id: "s1" }, [
        makeLesson({ id: "l1" }),
        makeLesson({ id: "l2" }),
      ]);
      const section2 = makeSection({ id: "s2" }, [makeLesson({ id: "l3" })]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "reorder-lessons",
        sectionId: "s1",
        lessonIds: ["l2", "l1"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[1]).toBe(section2);
    });

    it("appends lessons not in lessonIds at the end", () => {
      const lesson1 = makeLesson({ id: "l1" });
      const lesson2 = makeLesson({ id: "l2" });
      const lesson3 = makeLesson({ id: "l3" });
      const section = makeSection({ id: "s1" }, [lesson1, lesson2, lesson3]);
      const loaderData = makeLoaderData([section]);

      const event: CourseEditorEvent = {
        type: "reorder-lessons",
        sectionId: "s1",
        lessonIds: ["l3", "l1"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(
        result.selectedCourse!.sections[0]!.lessons.map((l) => l.id)
      ).toEqual(["l3", "l1", "l2"]);
    });
  });

  describe("move-lesson-to-section", () => {
    it("moves a lesson from one section to the end of another", () => {
      const lesson1 = makeLesson({ id: "l1" });
      const lesson2 = makeLesson({ id: "l2" });
      const lesson3 = makeLesson({ id: "l3" });
      const section1 = makeSection({ id: "s1" }, [lesson1, lesson2]);
      const section2 = makeSection({ id: "s2" }, [lesson3]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "move-lesson-to-section",
        lessonId: "l1",
        targetSectionId: "s2",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(
        result.selectedCourse!.sections[0]!.lessons.map((l) => l.id)
      ).toEqual(["l2"]);
      expect(
        result.selectedCourse!.sections[1]!.lessons.map((l) => l.id)
      ).toEqual(["l3", "l1"]);
    });

    it("does not mutate the original loaderData", () => {
      const lesson1 = makeLesson({ id: "l1" });
      const lesson2 = makeLesson({ id: "l2" });
      const section1 = makeSection({ id: "s1" }, [lesson1]);
      const section2 = makeSection({ id: "s2" }, [lesson2]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "move-lesson-to-section",
        lessonId: "l1",
        targetSectionId: "s2",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).not.toBe(loaderData);
      expect(
        loaderData.selectedCourse!.sections[0]!.lessons.map((l) => l.id)
      ).toEqual(["l1"]);
      expect(
        loaderData.selectedCourse!.sections[1]!.lessons.map((l) => l.id)
      ).toEqual(["l2"]);
    });

    it("moves the lesson without touching any other lesson's or section's path", () => {
      // Neither section's title changes, so neither section's path changes,
      // and the moved lesson's path is just its own (unchanged) title's slug.
      // See docs/adr/0028-drop-numbered-path-prefix.
      const section1 = makeSection(
        { id: "s1", path: "intro", title: "intro" },
        [
          makeLesson({ id: "l1", path: "a", title: "a", order: 0 }),
          makeLesson({ id: "keep", path: "b", title: "b", order: 1 }),
        ]
      );
      const section2 = makeSection({ id: "s2", path: "next", title: "next" }, [
        makeLesson({ id: "existing", path: "c", title: "c", order: 0 }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "move-lesson-to-section",
        lessonId: "l1",
        targetSectionId: "s2",
      };

      const result = applyOptimisticEvent(loaderData, event);

      const target = result.selectedCourse!.sections[1]!;
      // Appended to the end of the target; path is just its own title's slug.
      expect(target.lessons.map((l) => l.id)).toEqual(["existing", "l1"]);
      expect(target.lessons[1]!.path).toBe("a");
      // Source's remaining lesson keeps its own path untouched.
      const source = result.selectedCourse!.sections[0]!;
      expect(source.lessons.map((l) => l.id)).toEqual(["keep"]);
      expect(source.lessons[0]!.path).toBe("b");
    });

    it("inserts before the drop anchor when beforeLessonId is set", () => {
      const section1 = makeSection(
        { id: "s1", path: "intro", title: "intro" },
        [
          makeLesson({ id: "l1", path: "a", title: "a", order: 0 }),
          makeLesson({ id: "keep", path: "b", title: "b", order: 1 }),
        ]
      );
      const section2 = makeSection({ id: "s2", path: "next", title: "next" }, [
        makeLesson({ id: "t1", path: "c", title: "c", order: 0 }),
        makeLesson({ id: "t2", path: "d", title: "d", order: 1 }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "move-lesson-to-section",
        lessonId: "l1",
        targetSectionId: "s2",
        beforeLessonId: "t2",
      };

      const result = applyOptimisticEvent(loaderData, event);

      const target = result.selectedCourse!.sections[1]!;
      expect(target.lessons.map((l) => l.id)).toEqual(["t1", "l1", "t2"]);
      expect(target.lessons[1]!.path).toBe("a");
      expect(target.lessons[2]!.path).toBe("d");
    });

    it("returns loaderData unchanged when lesson is not found", () => {
      const section1 = makeSection({ id: "s1" }, [makeLesson({ id: "l1" })]);
      const section2 = makeSection({ id: "s2" }, []);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "move-lesson-to-section",
        lessonId: "nonexistent",
        targetSectionId: "s2",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("returns loaderData unchanged when target section is not found", () => {
      const section1 = makeSection({ id: "s1" }, [makeLesson({ id: "l1" })]);
      const loaderData = makeLoaderData([section1]);

      const event: CourseEditorEvent = {
        type: "move-lesson-to-section",
        lessonId: "l1",
        targetSectionId: "nonexistent",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("leaves sections outside the move structurally unchanged", () => {
      // A move never touches any section's title/path, so an unrelated
      // section keeps its structure (attachDerivedPaths recomputes every
      // path from the same, unchanged title, so it deep-equals the input —
      // even though it isn't the same object).
      const section1 = makeSection(
        { id: "s1", path: "intro", title: "intro" },
        [
          makeLesson({ id: "l1", path: "a", title: "a", order: 0 }),
          makeLesson({ id: "keep", path: "b", title: "b", order: 1 }),
        ]
      );
      const section2 = makeSection({ id: "s2", path: "next", title: "next" }, [
        makeLesson({ id: "existing", path: "c", title: "c", order: 0 }),
      ]);
      const section3 = makeSection(
        { id: "s3", path: "other", title: "other" },
        [makeLesson({ id: "l3", path: "d", title: "d", order: 0 })]
      );
      const loaderData = makeLoaderData([section1, section2, section3]);

      const event: CourseEditorEvent = {
        type: "move-lesson-to-section",
        lessonId: "l1",
        targetSectionId: "s2",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[2]).toEqual(section3);
    });

    it("moves to an empty target section", () => {
      const lesson1 = makeLesson({ id: "l1" });
      const section1 = makeSection({ id: "s1" }, [lesson1]);
      const section2 = makeSection({ id: "s2" }, []);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "move-lesson-to-section",
        lessonId: "l1",
        targetSectionId: "s2",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.lessons).toEqual([]);
      expect(
        result.selectedCourse!.sections[1]!.lessons.map((l) => l.id)
      ).toEqual(["l1"]);
    });

    it("returns loaderData by reference when source and target are the same section", () => {
      const lesson1 = makeLesson({ id: "l1" });
      const section1 = makeSection({ id: "s1" }, [lesson1]);
      const loaderData = makeLoaderData([section1]);

      const event: CourseEditorEvent = {
        type: "move-lesson-to-section",
        lessonId: "l1",
        targetSectionId: "s1",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });
  });

  describe("move-lessons-to-section", () => {
    it("moves a whole multi-lesson selection into another section as a block", () => {
      const section1 = makeSection(
        { id: "s1", path: "intro", title: "intro" },
        [
          makeLesson({ id: "a", path: "a", title: "a", order: 0 }),
          makeLesson({ id: "b", path: "b", title: "b", order: 1 }),
          makeLesson({ id: "c", path: "c", title: "c", order: 2 }),
        ]
      );
      const section2 = makeSection({ id: "s2", path: "next", title: "next" }, [
        makeLesson({ id: "x", path: "x", title: "x", order: 0 }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "move-lessons-to-section",
        lessonIds: ["a", "c"],
        targetSectionId: "s2",
      };

      const result = applyOptimisticEvent(loaderData, event);

      // Both selected lessons land in the target, appended as a block in
      // selection order; the unselected source lesson keeps its own path.
      const source = result.selectedCourse!.sections[0]!;
      const target = result.selectedCourse!.sections[1]!;
      expect(source.lessons.map((l) => l.id)).toEqual(["b"]);
      expect(source.lessons[0]!.path).toBe("b");
      expect(target.lessons.map((l) => l.id)).toEqual(["x", "a", "c"]);
      expect(target.lessons[1]!.path).toBe("a");
      expect(target.lessons[2]!.path).toBe("c");
    });

    it("inserts the block before the drop anchor", () => {
      const section1 = makeSection(
        { id: "s1", path: "intro", title: "intro" },
        [
          makeLesson({ id: "a", path: "a", title: "a", order: 0 }),
          makeLesson({ id: "b", path: "b", title: "b", order: 1 }),
        ]
      );
      const section2 = makeSection({ id: "s2", path: "next", title: "next" }, [
        makeLesson({ id: "x", path: "x", title: "x", order: 0 }),
        makeLesson({ id: "y", path: "y", title: "y", order: 1 }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "move-lessons-to-section",
        lessonIds: ["a", "b"],
        targetSectionId: "s2",
        beforeLessonId: "y",
      };

      const result = applyOptimisticEvent(loaderData, event);

      const target = result.selectedCourse!.sections[1]!;
      expect(target.lessons.map((l) => l.id)).toEqual(["x", "a", "b", "y"]);
    });

    it("does not mutate the original loaderData", () => {
      const section1 = makeSection({ id: "s1", path: "01-intro" }, [
        makeLesson({ id: "a", path: "01.01-a", order: 0 }),
        makeLesson({ id: "b", path: "01.02-b", order: 1 }),
      ]);
      const section2 = makeSection({ id: "s2", path: "02-next" }, [
        makeLesson({ id: "x", path: "02.01-x", order: 0 }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      applyOptimisticEvent(loaderData, {
        type: "move-lessons-to-section",
        lessonIds: ["a", "b"],
        targetSectionId: "s2",
      });

      expect(
        loaderData.selectedCourse!.sections[0]!.lessons.map((l) => l.id)
      ).toEqual(["a", "b"]);
      expect(
        loaderData.selectedCourse!.sections[1]!.lessons.map((l) => l.id)
      ).toEqual(["x"]);
    });
  });

  describe("defensive handling", () => {
    it("reorder-sections: handles duplicate sectionIds gracefully", () => {
      const section1 = makeSection({ id: "s1" });
      const section2 = makeSection({ id: "s2" }, [
        makeLesson({ id: "lesson-2" }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "reorder-sections",
        sectionIds: ["s2", "s2", "s1"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections.map((s) => s.id)).toEqual([
        "s2",
        "s1",
      ]);
    });

    it("reorder-sections: returns unchanged when all sectionIds are unknown", () => {
      const section1 = makeSection({ id: "s1" });
      const loaderData = makeLoaderData([section1]);

      const event: CourseEditorEvent = {
        type: "reorder-sections",
        sectionIds: ["unknown-1", "unknown-2"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("reorder-lessons: returns unchanged with empty lessonIds", () => {
      const section = makeSection({ id: "s1" }, [
        makeLesson({ id: "l1" }),
        makeLesson({ id: "l2" }),
      ]);
      const loaderData = makeLoaderData([section]);

      const event: CourseEditorEvent = {
        type: "reorder-lessons",
        sectionId: "s1",
        lessonIds: [],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("reorder-lessons: handles duplicate lessonIds gracefully", () => {
      const lesson1 = makeLesson({ id: "l1" });
      const lesson2 = makeLesson({ id: "l2" });
      const section = makeSection({ id: "s1" }, [lesson1, lesson2]);
      const loaderData = makeLoaderData([section]);

      const event: CourseEditorEvent = {
        type: "reorder-lessons",
        sectionId: "s1",
        lessonIds: ["l2", "l2", "l1"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(
        result.selectedCourse!.sections[0]!.lessons.map((l) => l.id)
      ).toEqual(["l2", "l1"]);
    });
  });
});
