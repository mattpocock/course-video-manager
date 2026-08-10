import { useEffectReducer } from "use-effect-reducer";
import {
  courseViewReducer,
  createInitialCourseViewState,
} from "@/features/course-view/course-view-reducer";

export function useCourseViewReducer() {
  const [state, dispatch] = useEffectReducer(
    courseViewReducer,
    createInitialCourseViewState(),
    {}
  );

  return { state, dispatch };
}
