import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { courseViewReducer } from "@/features/course-view/course-view-reducer";
import type { LoaderData } from "./course-view-types";
import { ChevronDown } from "lucide-react";
import { useEffect } from "react";
import { useFetcher, useLocation, useNavigate } from "react-router";
import {
  CourseMenuContent,
  readCourseMenuIntent,
  type CourseMenuAction,
  type CourseMenuFacts,
} from "./course-menu";

export function ActionsDropdown({
  currentCourse,
  data,
  dispatch,
  archiveCourseFetcher,
  handleBatchExport,
}: {
  currentCourse: NonNullable<LoaderData["selectedCourse"]>;
  data: LoaderData;
  dispatch: (action: courseViewReducer.Action) => void;
  archiveCourseFetcher: ReturnType<typeof useFetcher>;
  handleBatchExport: () => void;
}) {
  const navigate = useNavigate();

  const course: CourseMenuFacts = {
    id: currentCourse.id,
    archived: currentCourse.archived,
    isLatestVersion: data.isLatestVersion,
    hasVersion: !!data.selectedVersion,
    hasPreviousVersion: !!data.selectedVersion && data.versions.length > 1,
    hasLessons: currentCourse.sections.some((s) => s.lessons.length > 0),
  };

  const run = (action: CourseMenuAction) => {
    switch (action) {
      case "preview-changelog":
        return void navigate(`/courses/${currentCourse.id}/changelog`);
      case "view-archived-lessons":
        return void navigate(`/courses/${currentCourse.id}/archived-lessons`);
      case "publish":
        return void navigate(`/courses/${currentCourse.id}/publish`);
      case "export":
        return handleBatchExport();
      case "rename":
        return dispatch({ type: "set-rename-course-modal-open", open: true });
      case "duplicate":
        return dispatch({
          type: "set-duplicate-course-modal-open",
          open: true,
        });
      case "copy-transcript":
        return dispatch({ type: "set-copy-transcript-modal-open", open: true });
      case "purge-exports":
        return dispatch({ type: "set-purge-exports-modal-open", open: true });
      case "archive":
      case "unarchive":
        return void archiveCourseFetcher.submit(
          { archived: action === "archive" ? "true" : "false" },
          {
            method: "post",
            action: `/api/courses/${currentCourse.id}/archive`,
          }
        );
    }
  };

  useCourseMenuIntent(run);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">
          Actions
          <ChevronDown className="w-4 h-4 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <CourseMenuContent
        menu="dropdown"
        align="start"
        course={course}
        run={run}
      />
    </DropdownMenu>
  );
}

/**
 * Runs a Course action the sidebar's right-click sent here (a
 * `CourseMenuIntent`) once on arrival, then clears it from history so Back
 * does not reopen the dialog.
 */
function useCourseMenuIntent(run: (action: CourseMenuAction) => void) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const action = readCourseMenuIntent(location.state);
    if (!action) return;
    run(action);
    void navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: null,
      preventScrollReset: true,
    });
    // Once per arrival: location.key changes with every navigation.
  }, [location.key]);
}
