import { describe, it, expect } from "vitest";
import {
  applyOptimisticEvent,
  courseEditorFetcherKey,
  courseEditorFetcherKeyForEvent,
} from "./optimistic-applier";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import {
  makeLesson,
  makeSection,
  makeLoaderData,
} from "./optimistic-applier-test-helpers";

describe("applyOptimisticEvent – composition and edge cases", () => {
  describe("cross-event sequential composition", () => {
    it("delete-lesson then archive-section on the emptied section", () => {
      const loaderData = makeLoaderData([
        makeSection({ id: "section-1" }, [makeLesson({ id: "lesson-1" })]),
        makeSection({ id: "section-2" }, [makeLesson({ id: "lesson-2" })]),
      ]);

      const del: CourseEditorEvent = {
        type: "delete-lesson",
        lessonId: "lesson-1",
      };
      const archive: CourseEditorEvent = {
        type: "archive-section",
        sectionId: "section-1",
      };

      const afterDelete = applyOptimisticEvent(loaderData, del);
      const result = applyOptimisticEvent(afterDelete, archive);

      expect(result.selectedCourse!.sections).toHaveLength(1);
      expect(result.selectedCourse!.sections[0]!.id).toBe("section-2");
    });
  });

  describe("passthrough for unhandled events", () => {
    it("returns loaderData unchanged for create-section", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "create-section",
        repoVersionId: "v1",
        title: "New Section",
        maxOrder: 1,
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("returns loaderData unchanged for add-ghost-lesson", () => {
      const loaderData = makeLoaderData();
      const event: CourseEditorEvent = {
        type: "add-ghost-lesson",
        sectionId: "section-1",
        title: "Ghost Lesson",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });
  });

  describe("undefined selectedCourse", () => {
    it("returns loaderData unchanged", () => {
      const loaderData = makeLoaderData();
      (loaderData as any).selectedCourse = undefined;

      const event: CourseEditorEvent = {
        type: "update-lesson-icon",
        lessonId: "lesson-1",
        icon: "code",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });
  });

  describe("empty and edge-case structures", () => {
    it("returns loaderData unchanged when sections array is empty", () => {
      const loaderData = makeLoaderData([]);
      const event: CourseEditorEvent = {
        type: "update-lesson-icon",
        lessonId: "lesson-1",
        icon: "code",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("returns loaderData unchanged when section has no lessons", () => {
      const loaderData = makeLoaderData([makeSection({}, [])]);
      const event: CourseEditorEvent = {
        type: "update-lesson-icon",
        lessonId: "lesson-1",
        icon: "code",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });

    it("preserves reference equality for unchanged sections", () => {
      const section1 = makeSection({ id: "section-1" });
      const section2 = makeSection({ id: "section-2" }, [
        makeLesson({ id: "lesson-2" }),
      ]);
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "update-lesson-icon",
        lessonId: "lesson-2",
        icon: "code",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]).toBe(section1);
      expect(result.selectedCourse!.sections[1]).not.toBe(section2);
    });

    it("preserves reference equality for unchanged sections in section events", () => {
      const section1 = makeSection({ id: "section-1" });
      const section2 = makeSection({ id: "section-2" });
      const loaderData = makeLoaderData([section1, section2]);

      const event: CourseEditorEvent = {
        type: "update-section-description",
        sectionId: "section-2",
        description: "Updated",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result.selectedCourse!.sections[0]).toBe(section1);
      expect(result.selectedCourse!.sections[1]).not.toBe(section2);
    });

    it("returns loaderData unchanged for section events when selectedCourse is undefined", () => {
      const loaderData = makeLoaderData();
      (loaderData as any).selectedCourse = undefined;

      const event: CourseEditorEvent = {
        type: "update-section-name",
        sectionId: "section-1",
        title: "new-name",
      };

      const result = applyOptimisticEvent(loaderData, event);

      expect(result).toBe(loaderData);
    });
  });

  describe("sequential event composition", () => {
    it("applies two update-lesson-icon events on different lessons", () => {
      const section = makeSection({}, [
        makeLesson({ id: "lesson-1", icon: "watch" }),
        makeLesson({ id: "lesson-2", icon: "watch" }),
      ]);
      const loaderData = makeLoaderData([section]);

      const event1: CourseEditorEvent = {
        type: "update-lesson-icon",
        lessonId: "lesson-1",
        icon: "code",
      };
      const event2: CourseEditorEvent = {
        type: "update-lesson-icon",
        lessonId: "lesson-2",
        icon: "discussion",
      };

      const intermediate = applyOptimisticEvent(loaderData, event1);
      const result = applyOptimisticEvent(intermediate, event2);

      expect(result.selectedCourse!.sections[0]!.lessons[0]!.icon).toBe("code");
      expect(result.selectedCourse!.sections[0]!.lessons[1]!.icon).toBe(
        "discussion"
      );
    });

    it("last write wins when two events target the same lesson", () => {
      const loaderData = makeLoaderData();
      const event1: CourseEditorEvent = {
        type: "update-lesson-icon",
        lessonId: "lesson-1",
        icon: "code",
      };
      const event2: CourseEditorEvent = {
        type: "update-lesson-icon",
        lessonId: "lesson-1",
        icon: "discussion",
      };

      const intermediate = applyOptimisticEvent(loaderData, event1);
      const result = applyOptimisticEvent(intermediate, event2);

      expect(result.selectedCourse!.sections[0]!.lessons[0]!.icon).toBe(
        "discussion"
      );
    });
  });
});

describe("courseEditorFetcherKey", () => {
  it("formats the key as course-editor:<type>:<id>", () => {
    expect(courseEditorFetcherKey("update-lesson-icon", "lesson-1")).toBe(
      "course-editor:update-lesson-icon:lesson-1"
    );
  });
});

describe("courseEditorFetcherKeyForEvent", () => {
  it("uses lessonId for lesson events", () => {
    expect(
      courseEditorFetcherKeyForEvent({
        type: "update-lesson-icon",
        lessonId: "L1",
        icon: "code",
      })
    ).toBe("course-editor:update-lesson-icon:L1");
  });

  it("uses sectionId for section events", () => {
    expect(
      courseEditorFetcherKeyForEvent({
        type: "update-section-name",
        sectionId: "S1",
        title: "New",
      })
    ).toBe("course-editor:update-section-name:S1");
  });

  it("uses repoVersionId for create-section", () => {
    expect(
      courseEditorFetcherKeyForEvent({
        type: "create-section",
        repoVersionId: "V1",
        title: "New",
        maxOrder: 0,
      })
    ).toBe("course-editor:create-section:V1");
  });

  it('uses "batch" for reorder-sections', () => {
    expect(
      courseEditorFetcherKeyForEvent({
        type: "reorder-sections",
        sectionIds: ["S1", "S2"],
      })
    ).toBe("course-editor:reorder-sections:batch");
  });

  it("uses sectionId for reorder-lessons", () => {
    expect(
      courseEditorFetcherKeyForEvent({
        type: "reorder-lessons",
        sectionId: "S1",
        lessonIds: ["L1", "L2"],
      })
    ).toBe("course-editor:reorder-lessons:S1");
  });
});
