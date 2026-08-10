import { useRef, useState } from "react";
import type {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import type { Section } from "./course-view-types";
import type { courseViewReducer } from "./course-view-reducer";
import {
  resolveLessonDrop,
  buildLessonDropEvent,
  type LessonDrop,
} from "./course-editor-helpers";

/**
 * Drives lesson and section dragging within the course view's single
 * DndContext. Within-section drops become a `reorder-lessons`; cross-section
 * drops become a `move-lesson-to-section` (or `move-lessons-to-section` for a
 * multi-lesson selection) anchored at the drop position. Section drags are
 * delegated to `onSectionDragEnd`. The returned `dropIndicator` powers the
 * insertion line, `activeLesson` powers the overlay.
 *
 * When a multi-lesson selection exists, dragging a selected lesson's grip
 * moves the whole set — within or across sections; dragging an unselected
 * lesson clears the selection and degrades to single-drag.
 */
export function useLessonDrag(opts: {
  sections: Section[];
  submitEvent: (event: CourseEditorEvent) => void;
  onSectionDragEnd: (event: DragEndEvent) => void;
  lessonSelection: courseViewReducer.LessonSelection;
  dispatch: (action: courseViewReducer.Action) => void;
}) {
  const { sections, submitEvent, onSectionDragEnd, lessonSelection, dispatch } =
    opts;

  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<LessonDrop | null>(null);
  const [bulkDragIds, setBulkDragIds] = useState<Set<string> | null>(null);

  // React state set in onDragStart may not be committed before onDragEnd fires.
  const bulkDragIdsRef = useRef<Set<string> | null>(null);

  const onDragStart = (event: DragStartEvent) => {
    if (event.active.data.current?.type === "lesson") {
      const draggedId = String(event.active.id);
      setActiveLessonId(draggedId);

      if (
        lessonSelection &&
        lessonSelection.lessonIds.has(draggedId) &&
        lessonSelection.lessonIds.size > 1
      ) {
        bulkDragIdsRef.current = lessonSelection.lessonIds;
        setBulkDragIds(lessonSelection.lessonIds);
      } else {
        bulkDragIdsRef.current = null;
        setBulkDragIds(null);
        if (lessonSelection) {
          dispatch({ type: "clear-lesson-selection" });
        }
      }
    }
  };

  const onDragOver = (event: DragOverEvent) => {
    if (event.active.data.current?.type !== "lesson") return;
    setDropIndicator(resolveLessonDrop(event, sections));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const type = event.active.data.current?.type;
    const currentBulkDragIds = bulkDragIdsRef.current;
    bulkDragIdsRef.current = null;
    setActiveLessonId(null);
    setDropIndicator(null);
    setBulkDragIds(null);

    if (type === "section") {
      onSectionDragEnd(event);
      return;
    }
    if (type !== "lesson") return;

    const lessonId = String(event.active.id);
    const drop = resolveLessonDrop(event, sections);
    if (!drop) return;

    const editorEvent = buildLessonDropEvent({
      sections,
      lessonId,
      drop,
      bulkDragIds: currentBulkDragIds,
    });
    if (editorEvent) {
      submitEvent(editorEvent);
    }

    dispatch({ type: "clear-lesson-selection" });
  };

  const onDragCancel = () => {
    bulkDragIdsRef.current = null;
    setActiveLessonId(null);
    setDropIndicator(null);
    setBulkDragIds(null);
  };

  const activeLesson = activeLessonId
    ? sections.flatMap((s) => s.lessons).find((l) => l.id === activeLessonId)
    : null;

  return {
    dropIndicator,
    activeLesson,
    bulkDragIds,
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel,
  };
}
