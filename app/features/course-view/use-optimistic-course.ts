import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetchers } from "react-router";
import { toast } from "sonner";
import type { CourseEditorEvent } from "@/services/course-editor-service";
import type { LoaderData } from "./course-view-types";
import {
  applyOptimisticEvent,
  applyOptimisticDeleteVideo,
  COURSE_EDITOR_KEY_PREFIX,
  DELETE_VIDEO_KEY_PREFIX,
} from "./optimistic-applier";

function parseCourseEditorEvent(
  fetcher: ReturnType<typeof useFetchers>[number]
): CourseEditorEvent | null {
  if (fetcher.json != null && typeof fetcher.json === "object") {
    return fetcher.json as CourseEditorEvent;
  }
  return null;
}

export function useOptimisticCourse(loaderData: LoaderData): LoaderData {
  const fetchers = useFetchers();

  return useMemo(() => {
    let result = loaderData;
    for (const fetcher of fetchers) {
      if (fetcher.state === "idle") continue;

      if (fetcher.formAction === "/api/course-editor") {
        const event = parseCourseEditorEvent(fetcher);
        if (!event) continue;
        result = applyOptimisticEvent(result, event);
      } else if (fetcher.formAction === "/api/videos/delete") {
        const videoId = fetcher.formData?.get("videoId");
        if (typeof videoId !== "string") continue;
        result = applyOptimisticDeleteVideo(result, videoId);
      }
    }
    return result;
  }, [loaderData, fetchers]);
}

export function useCourseEditorFailureToast() {
  const fetchers = useFetchers();
  const prevStatesRef = useRef<Map<string, string>>(new Map());
  const [divergenceReport, setDivergenceReport] = useState<string | null>(null);

  useEffect(() => {
    const prevStates = prevStatesRef.current;
    const nextStates = new Map<string, string>();

    for (const fetcher of fetchers) {
      const isOptimistic =
        fetcher.key.startsWith(COURSE_EDITOR_KEY_PREFIX) ||
        fetcher.key.startsWith(DELETE_VIDEO_KEY_PREFIX);
      if (!isOptimistic) continue;

      nextStates.set(fetcher.key, fetcher.state);

      const prevState = prevStates.get(fetcher.key);
      if (
        prevState &&
        prevState !== "idle" &&
        fetcher.state === "idle" &&
        fetcher.data instanceof Response &&
        !fetcher.data.ok
      ) {
        if (fetcher.data.status === 409) {
          fetcher.data
            .clone()
            .text()
            .then((body) => {
              try {
                const parsed = JSON.parse(body);
                setDivergenceReport(typeof parsed === "string" ? parsed : body);
              } catch {
                setDivergenceReport(body);
              }
            });
        } else {
          toast.error("Action failed — your change was reverted.");
        }
      }
    }

    prevStatesRef.current = nextStates;
  }, [fetchers]);

  const clearDivergenceReport = useCallback(
    () => setDivergenceReport(null),
    []
  );

  return { divergenceReport, clearDivergenceReport };
}
