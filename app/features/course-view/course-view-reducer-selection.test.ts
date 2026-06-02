import { describe, it, expect } from "vitest";
import { ReducerTester } from "../../test-utils/reducer-tester";
import {
  courseViewReducer,
  createInitialCourseViewState,
} from "./course-view-reducer";

const createTester = () =>
  new ReducerTester(courseViewReducer, createInitialCourseViewState());

describe("courseViewReducer — lesson selection", () => {
  it("46. lessonSelection is null initially", () => {
    const state = createTester().getState();
    expect(state.lessonSelection).toBeNull();
  });

  it("47. select-lesson-only: selects one lesson", () => {
    const state = createTester()
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .getState();
    expect(state.lessonSelection).toEqual({
      sectionId: "section-1",
      lessonIds: new Set(["lesson-1"]),
    });
  });

  it("48. select-lesson-only: replaces prior selection in same section", () => {
    const state = createTester()
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-2",
        sectionId: "section-1",
      })
      .getState();
    expect(state.lessonSelection).toEqual({
      sectionId: "section-1",
      lessonIds: new Set(["lesson-2"]),
    });
  });

  it("49. select-lesson-only: replaces when different section", () => {
    const state = createTester()
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-3",
        sectionId: "section-2",
      })
      .getState();
    expect(state.lessonSelection).toEqual({
      sectionId: "section-2",
      lessonIds: new Set(["lesson-3"]),
    });
  });

  it("50. toggle-lesson-selection: adds lesson in same section", () => {
    const state = createTester()
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .send({
        type: "toggle-lesson-selection",
        lessonId: "lesson-2",
        sectionId: "section-1",
      })
      .getState();
    expect(state.lessonSelection).toEqual({
      sectionId: "section-1",
      lessonIds: new Set(["lesson-1", "lesson-2"]),
    });
  });

  it("51. toggle-lesson-selection: removes lesson from same section", () => {
    const state = createTester()
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .send({
        type: "toggle-lesson-selection",
        lessonId: "lesson-2",
        sectionId: "section-1",
      })
      .send({
        type: "toggle-lesson-selection",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .getState();
    expect(state.lessonSelection).toEqual({
      sectionId: "section-1",
      lessonIds: new Set(["lesson-2"]),
    });
  });

  it("52. toggle-lesson-selection: resets when different section", () => {
    const state = createTester()
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .send({
        type: "toggle-lesson-selection",
        lessonId: "lesson-2",
        sectionId: "section-1",
      })
      .send({
        type: "toggle-lesson-selection",
        lessonId: "lesson-5",
        sectionId: "section-2",
      })
      .getState();
    expect(state.lessonSelection).toEqual({
      sectionId: "section-2",
      lessonIds: new Set(["lesson-5"]),
    });
  });

  it("53. toggle-lesson-selection: clears to null when last lesson removed", () => {
    const state = createTester()
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .send({
        type: "toggle-lesson-selection",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .getState();
    expect(state.lessonSelection).toBeNull();
  });

  it("54. toggle-lesson-selection: creates fresh selection when none exists", () => {
    const state = createTester()
      .send({
        type: "toggle-lesson-selection",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .getState();
    expect(state.lessonSelection).toEqual({
      sectionId: "section-1",
      lessonIds: new Set(["lesson-1"]),
    });
  });

  it("55. clear-lesson-selection: clears selection", () => {
    const state = createTester()
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .send({ type: "clear-lesson-selection" })
      .getState();
    expect(state.lessonSelection).toBeNull();
  });

  it("56. clear-lesson-selection: no-op when already null", () => {
    const state = createTester()
      .send({ type: "clear-lesson-selection" })
      .getState();
    expect(state.lessonSelection).toBeNull();
  });

  it("57. prune-lesson-selection: drops vanished IDs, keeps the rest", () => {
    const state = createTester()
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .send({
        type: "toggle-lesson-selection",
        lessonId: "lesson-2",
        sectionId: "section-1",
      })
      .send({
        type: "toggle-lesson-selection",
        lessonId: "lesson-3",
        sectionId: "section-1",
      })
      .send({
        type: "prune-lesson-selection",
        currentLessonIds: ["lesson-1", "lesson-3", "lesson-4"],
      })
      .getState();
    expect(state.lessonSelection).toEqual({
      sectionId: "section-1",
      lessonIds: new Set(["lesson-1", "lesson-3"]),
    });
  });

  it("58. prune-lesson-selection: clears to null when all IDs vanish", () => {
    const state = createTester()
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .send({
        type: "prune-lesson-selection",
        currentLessonIds: ["lesson-99"],
      })
      .getState();
    expect(state.lessonSelection).toBeNull();
  });

  it("59. prune-lesson-selection: no-op when selection is null", () => {
    const tester = createTester();
    const before = tester.getState();
    const after = tester
      .send({
        type: "prune-lesson-selection",
        currentLessonIds: ["lesson-1"],
      })
      .getState();
    expect(after.lessonSelection).toBeNull();
    expect(before).toBe(after);
  });

  it("60. prune-lesson-selection: returns same state when nothing pruned", () => {
    const tester = createTester();
    tester.send({
      type: "select-lesson-only",
      lessonId: "lesson-1",
      sectionId: "section-1",
    });
    const before = tester.getState();
    const after = tester
      .send({
        type: "prune-lesson-selection",
        currentLessonIds: ["lesson-1", "lesson-2"],
      })
      .getState();
    expect(after.lessonSelection).toEqual({
      sectionId: "section-1",
      lessonIds: new Set(["lesson-1"]),
    });
    expect(before).toBe(after);
  });

  it("63. lesson selection does not affect other state", () => {
    const state = createTester()
      .send({ type: "toggle-priority-filter", priority: 1 })
      .send({ type: "set-add-course-modal-open", open: true })
      .send({
        type: "select-lesson-only",
        lessonId: "lesson-1",
        sectionId: "section-1",
      })
      .getState();
    expect(state.priorityFilter).toEqual([1]);
    expect(state.isAddCourseModalOpen).toBe(true);
    expect(state.lessonSelection).toEqual({
      sectionId: "section-1",
      lessonIds: new Set(["lesson-1"]),
    });
  });
});
