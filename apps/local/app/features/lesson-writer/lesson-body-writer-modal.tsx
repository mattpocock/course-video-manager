"use client";

import { useEffect, useMemo } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { postConfirmed } from "@/lib/post-confirmed";
import { WriterModal } from "@/features/article-writer/writer-modal";
import { toWriterContext } from "@/features/article-writer/use-writer-context";
import type { Mode } from "@/features/article-writer/types";
import { FIELD_MODES } from "@/features/article-writer/writer-engine-utils";
import type { WriterContextData } from "@/services/video-posting-context.server";

type LessonWriterData = {
  body: string | null;
  description: string | null;
  writerContext: WriterContextData;
};

// The modes the Lesson tab uses for the video body.
const BODY_MODES: Mode[] = FIELD_MODES["video-body"];

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
  const { revalidate } = useRevalidator();

  useEffect(() => {
    if (open && dataFetcher.state === "idle" && !dataFetcher.data) {
      dataFetcher.load(`/api/videos/${videoId}/lesson-writer`);
    }
  }, [open, videoId, dataFetcher]);

  const context = useMemo(
    () =>
      dataFetcher.data ? toWriterContext(dataFetcher.data.writerContext) : null,
    [dataFetcher.data]
  );

  // Resolves only on a confirmed save: local images are removed after it.
  const persistBody = async (newValue: string) => {
    await postConfirmed(`/api/videos/${videoId}/lesson-writer`, {
      intent: "updateBody",
      body: newValue,
    });
    void revalidate();
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
