"use client";

import { useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import { WriterModal } from "@/features/article-writer/writer-modal";
import { toWriterContext } from "@/features/article-writer/use-writer-context";
import type { Mode } from "@/features/article-writer/types";
import type { WriterContextData } from "@/services/video-posting-context.server";

type LessonWriterData = {
  body: string | null;
  description: string | null;
  writerContext: WriterContextData;
};

// Matches the modes the Lesson tab uses for the video body.
const BODY_MODES: Mode[] = ["article", "skill-building"];

/**
 * Opens the full AI Writer on a video's lesson body from anywhere (course-view
 * context menu, video-editor actions), fetching the writer context on demand.
 * Mount conditionally so each open starts from a fresh fetch.
 */
export function LessonBodyWriterModal({
  videoId,
  open,
  onOpenChange,
}: {
  videoId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dataFetcher = useFetcher<LessonWriterData>();
  const saveFetcher = useFetcher();

  useEffect(() => {
    if (open && dataFetcher.state === "idle" && !dataFetcher.data) {
      dataFetcher.load(`/api/videos/${videoId}/lesson-writer`);
    }
  }, [open, videoId, dataFetcher]);

  const context = useMemo(
    () =>
      dataFetcher.data
        ? toWriterContext(dataFetcher.data.writerContext)
        : null,
    [dataFetcher.data]
  );

  const persistBody = (newValue: string) => {
    saveFetcher.submit(
      { intent: "updateBody", body: newValue },
      { method: "post", action: `/api/videos/${videoId}/lesson-writer` }
    );
  };

  return (
    <WriterModal
      open={open}
      onOpenChange={onOpenChange}
      videoId={videoId}
      fieldId="video-body"
      modes={BODY_MODES}
      value={dataFetcher.data?.body ?? ""}
      context={context}
      onApply={persistBody}
    />
  );
}
