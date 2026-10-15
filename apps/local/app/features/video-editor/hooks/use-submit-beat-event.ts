import { useCallback } from "react";
import { useSubmit } from "react-router";
import { courseEditorFetcherKeyForEvent } from "@/features/course-view/optimistic-applier";
import type { CourseEditorEvent } from "@/services/course-editor-service";

/**
 * Beat edits from the editor's Beats tab submit to /api/course-editor with a
 * stable per-entity fetcher key and navigate:false — exactly like the pitch
 * page. Plain loader revalidation handles the refresh; no editor-specific
 * optimistic applier.
 */
export const useSubmitBeatEvent = () => {
  const submit = useSubmit();
  return useCallback(
    (event: CourseEditorEvent) => {
      submit(event, {
        method: "post",
        encType: "application/json",
        action: "/api/course-editor",
        navigate: false,
        fetcherKey: courseEditorFetcherKeyForEvent(event),
      });
    },
    [submit]
  );
};
