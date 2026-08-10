import { useCallback, useEffect, useRef } from "react";
import type { courseViewReducer } from "./course-view-reducer";

export function useLessonSelectionClear(
  lessonSelection: courseViewReducer.LessonSelection,
  dispatch: (action: courseViewReducer.Action) => void
) {
  const selectionRef = useRef(lessonSelection);
  selectionRef.current = lessonSelection;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectionRef.current) {
        dispatch({ type: "clear-lesson-selection" });
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [dispatch]);

  return useCallback(() => {
    if (selectionRef.current) {
      dispatch({ type: "clear-lesson-selection" });
    }
  }, [dispatch]);
}
