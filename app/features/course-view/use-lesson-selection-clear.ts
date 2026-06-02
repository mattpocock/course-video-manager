import { useCallback, useEffect } from "react";
import type { courseViewReducer } from "./course-view-reducer";

export function useLessonSelectionClear(
  lessonSelection: courseViewReducer.LessonSelection,
  dispatch: (action: courseViewReducer.Action) => void
) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && lessonSelection) {
        dispatch({ type: "clear-lesson-selection" });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [lessonSelection, dispatch]);

  const handleGridClick = useCallback(() => {
    if (lessonSelection) {
      dispatch({ type: "clear-lesson-selection" });
    }
  }, [lessonSelection, dispatch]);

  return handleGridClick;
}
