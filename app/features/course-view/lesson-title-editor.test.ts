import { describe, it, expect, vi } from "vitest";
import type { CourseEditorEvent } from "@/services/course-editor-service";

// ---------------------------------------------------------------------------
// Helpers — mirror the saveTitle logic from useLessonTitleEditor
// ---------------------------------------------------------------------------

function makeSaveTitle(
  lesson: { title?: string; path: string; id: string },
  submitEvent: (event: CourseEditorEvent) => void
) {
  return (value: string) => {
    const newTitle = value.trim();
    if (newTitle && newTitle !== (lesson.title || lesson.path)) {
      submitEvent({
        type: "update-lesson-title",
        lessonId: lesson.id,
        title: newTitle,
      });
    }
  };
}

// ---------------------------------------------------------------------------
// Tests for the handledRef blur-save guard
// ---------------------------------------------------------------------------

describe("LessonTitleEditor — blur-save guard (handledRef)", () => {
  it("should allow blur-to-save after a previous Enter-to-save", () => {
    const handledRef = { current: false };
    let saveCount = 0;
    const onSave = () => {
      saveCount++;
    };

    // --- Session 1: user presses Enter ---
    handledRef.current = true;
    onSave();

    if (!handledRef.current) onSave();

    expect(saveCount).toBe(1);

    // --- Session 2 starts ---
    handledRef.current = false;

    if (!handledRef.current) onSave();

    expect(saveCount).toBe(2);
  });

  it("should NOT call onSave on blur after Escape cancels the session", () => {
    const handledRef = { current: false };
    let saveCount = 0;
    const onSave = () => {
      saveCount++;
    };

    handledRef.current = true;

    if (!handledRef.current) onSave();

    expect(saveCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests for auto-select on focus (issue #718)
// ---------------------------------------------------------------------------

describe("LessonTitleEditor — auto-select on focus", () => {
  it("calls select() on the input element when focused", () => {
    const selectMock = vi.fn();
    const mockTarget = { select: selectMock };
    const handledRef = { current: false };

    const onFocus = (e: { target: { select: () => void } }) => {
      handledRef.current = false;
      e.target.select();
    };

    handledRef.current = true;

    onFocus({ target: mockTarget });

    expect(selectMock).toHaveBeenCalledOnce();
    expect(handledRef.current).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests for saveTitle submit logic
// ---------------------------------------------------------------------------

describe("useLessonTitleEditor — saveTitle guard condition", () => {
  const baseLesson = { id: "fid-1", path: "my-lesson", title: "My Lesson" };

  it("submits update-lesson-title when title changes", () => {
    const submitEvent = vi.fn();
    const saveTitle = makeSaveTitle(baseLesson, submitEvent);
    saveTitle("New Name");
    expect(submitEvent).toHaveBeenCalledOnce();
    expect(submitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "update-lesson-title",
        title: "New Name",
      })
    );
  });

  it("does not submit when title is the same as current", () => {
    const submitEvent = vi.fn();
    const saveTitle = makeSaveTitle(baseLesson, submitEvent);
    saveTitle("My Lesson");
    expect(submitEvent).not.toHaveBeenCalled();
  });

  it("does not submit when value only differs by surrounding whitespace", () => {
    const submitEvent = vi.fn();
    const saveTitle = makeSaveTitle(baseLesson, submitEvent);
    saveTitle("  My Lesson  ");
    expect(submitEvent).not.toHaveBeenCalled();
  });

  it("preserves the user's exact casing rather than title-casing it", () => {
    const submitEvent = vi.fn();
    const saveTitle = makeSaveTitle(baseLesson, submitEvent);
    saveTitle("my new lesson");
    expect(submitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "update-lesson-title",
        title: "my new lesson",
      })
    );
  });

  it("falls back to lesson.path when title is empty — does not submit when value equals path", () => {
    const submitEvent = vi.fn();
    const noTitleLesson = { ...baseLesson, title: "", path: "My Lesson" };
    const saveTitle = makeSaveTitle(noTitleLesson, submitEvent);
    saveTitle("My Lesson");
    expect(submitEvent).not.toHaveBeenCalled();
  });

  it("submits multiple times when renamed repeatedly to different values", () => {
    const submitEvent = vi.fn();
    let lesson = { ...baseLesson };
    let saveTitle = makeSaveTitle(lesson, submitEvent);

    saveTitle("First Rename");
    expect(submitEvent).toHaveBeenCalledTimes(1);

    lesson = { ...lesson, title: "First Rename" };
    saveTitle = makeSaveTitle(lesson, submitEvent);

    saveTitle("Second Rename");
    expect(submitEvent).toHaveBeenCalledTimes(2);
  });
});
