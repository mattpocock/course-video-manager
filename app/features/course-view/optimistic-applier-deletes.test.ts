import { describe, it, expect } from "vitest";
import { applyOptimisticEvent } from "./optimistic-applier";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import {
  makeLesson,
  makeSection,
  makeLoaderData,
} from "./optimistic-applier-test-helpers";

describe("applyOptimisticEvent – deletes and ghost toggle", () => {
  describe("delete-lesson", () => {
    it("removes the lesson from its containing section", () => {
      const loaderData = makeLoaderData([
        makeSection({}, [
          makeLesson({ id: "lesson-1" }),
          makeLesson({ id: "lesson-2" }),
        ]),
      ]);
      const event: CourseEditorEvent = {
        type: "delete-lesson",
        lessonId: "lesson-1",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.lessons).toHaveLength(1);
      expect(result.selectedCourse!.sections[0]!.lessons[0]!.id).toBe(
        "lesson-2"
      );
    });

    it("does not mutate the original loaderData", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "delete-lesson",
        lessonId: "lesson-1",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).not.toBe(loaderData);
      expect(loaderData.selectedCourse!.sections[0]!.lessons).toHaveLength(1);
    });

    it("returns loaderData unchanged when lesson is not found", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "delete-lesson",
        lessonId: "nonexistent",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("finds and removes lesson across multiple sections", () => {
      const section1 = makeSection({ id: "section-1" }, [
        makeLesson({ id: "lesson-1" }),
      ]);
      const section2 = makeSection({ id: "section-2" }, [
        makeLesson({ id: "lesson-2" }),
        makeLesson({ id: "lesson-3" }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "delete-lesson",
        lessonId: "lesson-2",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]).toBe(section1);
      expect(result.selectedCourse!.sections[1]!.lessons).toHaveLength(1);
      expect(result.selectedCourse!.sections[1]!.lessons[0]!.id).toBe(
        "lesson-3"
      );
    });

    it("leaves section with empty lessons when removing the only lesson", () => {
      const loaderData = makeLoaderData([
        makeSection({ id: "section-1" }, [makeLesson({ id: "lesson-1" })]),
      ]);
      const event: CourseEditorEvent = {
        type: "delete-lesson",
        lessonId: "lesson-1",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections).toHaveLength(1);
      expect(result.selectedCourse!.sections[0]!.lessons).toHaveLength(0);
    });

    it("preserves reference equality for sections after the match", () => {
      const section1 = makeSection({ id: "section-1" }, [
        makeLesson({ id: "lesson-1" }),
      ]);
      const section2 = makeSection({ id: "section-2" }, [
        makeLesson({ id: "lesson-2" }),
      ]);
      const section3 = makeSection({ id: "section-3" }, [
        makeLesson({ id: "lesson-3" }),
      ]);
      const loaderData = makeLoaderData([section1, section2, section3]);

      const event: CourseEditorEvent = {
        type: "delete-lesson",
        lessonId: "lesson-1",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]).not.toBe(section1);
      expect(result.selectedCourse!.sections[1]).toBe(section2);
      expect(result.selectedCourse!.sections[2]).toBe(section3);
    });
  });

  describe("archive-section", () => {
    it("removes the section from the course", () => {
      const section1 = makeSection({ id: "section-1" });
      const section2 = makeSection({ id: "section-2" }, [
        makeLesson({ id: "lesson-2" }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "archive-section",
        sectionId: "section-1",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections).toHaveLength(1);
      expect(result.selectedCourse!.sections[0]!.id).toBe("section-2");
    });

    it("does not mutate the original loaderData", () => {
      const loaderData = makeLoaderData([
        makeSection({ id: "section-1" }),
        makeSection({ id: "section-2" }, [makeLesson({ id: "lesson-2" })]),
      ]);
      const event: CourseEditorEvent = {
        type: "archive-section",
        sectionId: "section-1",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).not.toBe(loaderData);
      expect(loaderData.selectedCourse!.sections).toHaveLength(2);
    });

    it("returns loaderData unchanged when section is not found", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "archive-section",
        sectionId: "nonexistent",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("preserves reference equality for remaining sections", () => {
      const section1 = makeSection({ id: "section-1" });
      const section2 = makeSection({ id: "section-2" }, [
        makeLesson({ id: "lesson-2" }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "archive-section",
        sectionId: "section-1",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]).toBe(section2);
    });

    it("results in empty sections array when archiving the only section", () => {
      const loaderData = makeLoaderData([makeSection({ id: "section-1" })]);
      const event: CourseEditorEvent = {
        type: "archive-section",
        sectionId: "section-1",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections).toHaveLength(0);
    });
  });
});
