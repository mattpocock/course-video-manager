import { describe, it, expect } from "vitest";
import { applyOptimisticEvent } from "./optimistic-applier";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import {
  makeLesson,
  makeSection,
  makeLoaderData,
} from "./optimistic-applier-test-helpers";

describe("applyOptimisticEvent", () => {
  describe("update-lesson-icon", () => {
    it("patches the icon for the matching lesson", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-icon",
        lessonId: "lesson-1",
        icon: "code",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.lessons[0]!.icon).toBe("code");
    });

    it("does not mutate the original loaderData", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-icon",
        lessonId: "lesson-1",
        icon: "discussion",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).not.toBe(loaderData);
      expect(result.selectedCourse).not.toBe(loaderData.selectedCourse);
      expect(loaderData.selectedCourse!.sections[0]!.lessons[0]!.icon).toBe(
        "watch"
      );
    });

    it("returns loaderData unchanged when lesson is not found", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-icon",
        lessonId: "nonexistent",
        icon: "code",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("finds the lesson across multiple sections", () => {
      const lesson2 = makeLesson({ id: "lesson-2", icon: "watch" });
      const section2 = makeSection({ id: "section-2" }, [lesson2]);
      const loaderData = makeLoaderData([makeSection(), section2]);

      const event: CourseEditorEvent = {
        type: "update-lesson-icon",
        lessonId: "lesson-2",
        icon: "discussion",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[1]!.lessons[0]!.icon).toBe(
        "discussion"
      );
      expect(result.selectedCourse!.sections[0]!.lessons[0]!.icon).toBe(
        "watch"
      );
    });
  });

  describe("update-section-name", () => {
    it("patches the path for the matching section", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-section-name",
        sectionId: "section-1",
        title: "basics",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.path).toBe("01-basics");
    });

    it("returns loaderData unchanged when section is not found", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-section-name",
        sectionId: "nonexistent",
        title: "basics",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("handles ghost section path without numeric prefix", () => {
      const ghostSection = makeSection({
        id: "ghost-s",
        path: "My Ghost Section",
      });
      const loaderData = makeLoaderData([ghostSection]);
      const event: CourseEditorEvent = {
        type: "update-section-name",
        sectionId: "ghost-s",
        title: "Renamed Section",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.path).toBe("Renamed Section");
    });

    it("handles section path with dotted prefix", () => {
      const section = makeSection({ id: "section-1", path: "01.03-advanced" });
      const loaderData = makeLoaderData([section]);
      const event: CourseEditorEvent = {
        type: "update-section-name",
        sectionId: "section-1",
        title: "expert",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.path).toBe("01.03-expert");
    });

    it("does not mutate the original loaderData", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-section-name",
        sectionId: "section-1",
        title: "renamed",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).not.toBe(loaderData);
      expect(result.selectedCourse).not.toBe(loaderData.selectedCourse);
      expect(loaderData.selectedCourse!.sections[0]!.path).toBe(
        "01-fundamentals"
      );
    });
  });

  describe("update-section-description", () => {
    it("patches the description for the matching section", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-section-description",
        sectionId: "section-1",
        description: "A new description",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.description).toBe(
        "A new description"
      );
    });

    it("returns loaderData unchanged when section is not found", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-section-description",
        sectionId: "nonexistent",
        description: "A new description",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });
  });

  describe("update-lesson-name", () => {
    it("patches the path for the matching lesson", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-name",
        lessonId: "lesson-1",
        newSlug: "getting-started",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.lessons[0]!.path).toBe(
        "01-getting-started"
      );
    });

    it("returns loaderData unchanged when lesson is not found", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-name",
        lessonId: "nonexistent",
        newSlug: "getting-started",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("handles new-format lesson path with dotted prefix", () => {
      const lesson = makeLesson({ id: "lesson-1", path: "01.03-intro" });
      const loaderData = makeLoaderData([makeSection({}, [lesson])]);
      const event: CourseEditorEvent = {
        type: "update-lesson-name",
        lessonId: "lesson-1",
        newSlug: "overview",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.lessons[0]!.path).toBe(
        "01.03-overview"
      );
    });

    it("handles ghost lesson path without numeric prefix", () => {
      const lesson = makeLesson({ id: "lesson-1", path: "My Ghost Lesson" });
      const loaderData = makeLoaderData([makeSection({}, [lesson])]);
      const event: CourseEditorEvent = {
        type: "update-lesson-name",
        lessonId: "lesson-1",
        newSlug: "renamed-lesson",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.lessons[0]!.path).toBe(
        "renamed-lesson"
      );
    });

    it("preserves prefix when new slug contains hyphens", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-name",
        lessonId: "lesson-1",
        newSlug: "my-long-slug-name",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.lessons[0]!.path).toBe(
        "01-my-long-slug-name"
      );
    });
  });

  describe("update-lesson-title", () => {
    it("patches the title for the matching lesson", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-title",
        lessonId: "lesson-1",
        title: "New Title",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.lessons[0]!.title).toBe(
        "New Title"
      );
    });

    it("returns loaderData unchanged when lesson is not found", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-title",
        lessonId: "nonexistent",
        title: "New Title",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });
  });

  describe("update-lesson-description", () => {
    it("patches the description for the matching lesson", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-description",
        lessonId: "lesson-1",
        description: "A detailed description",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.lessons[0]!.description).toBe(
        "A detailed description"
      );
    });

    it("returns loaderData unchanged when lesson is not found", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-description",
        lessonId: "nonexistent",
        description: "A detailed description",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });
  });

  describe("update-lesson-priority", () => {
    it("patches the priority for the matching lesson", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-priority",
        lessonId: "lesson-1",
        priority: 1,
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]!.lessons[0]!.priority).toBe(1);
    });

    it("returns loaderData unchanged when lesson is not found", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-priority",
        lessonId: "nonexistent",
        priority: 3,
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });
  });

  describe("update-lesson-dependencies", () => {
    it("patches the dependencies for the matching lesson", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-dependencies",
        lessonId: "lesson-1",
        dependencies: ["dep-1", "dep-2"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(
        result.selectedCourse!.sections[0]!.lessons[0]!.dependencies
      ).toEqual(["dep-1", "dep-2"]);
    });

    it("returns loaderData unchanged when lesson is not found", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "update-lesson-dependencies",
        lessonId: "nonexistent",
        dependencies: ["dep-1"],
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });
  });

  describe("set-lesson-authoring-status", () => {
    it("patches the authoringStatus for the matching lesson", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "set-lesson-authoring-status",
        lessonId: "lesson-1",
        status: "done",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(
        result.selectedCourse!.sections[0]!.lessons[0]!.authoringStatus
      ).toBe("done");
    });

    it("returns loaderData unchanged when lesson is not found", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "set-lesson-authoring-status",
        lessonId: "nonexistent",
        status: "done",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });
  });
});
