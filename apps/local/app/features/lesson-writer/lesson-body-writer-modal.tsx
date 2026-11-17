"use client";

import { useEffect, useMemo } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { toast } from "@/components/ui/toast";
import { postConfirmed } from "@/lib/post-confirmed";
import { useEffectReducer } from "@/hooks/use-effect-reducer";
import { WriterModal } from "@/features/article-writer/writer-modal";
import { toWriterContext } from "@/features/article-writer/use-writer-context";
import type { Mode } from "@/features/article-writer/types";
import { FIELD_MODES } from "@/features/article-writer/writer-engine-utils";
import type { WriterContextData } from "@/services/video-posting-context.server";
import {
  createInitialLessonBodyChainState,
  lessonBodyChainReducer,
  writeStoredMore,
} from "./lesson-body-chain-reducer";

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
 *
 * With "More?" ticked, Apply moves on to the next Video with an empty Lesson
 * Body (`lesson-body-chain-reducer.ts`). The writer is keyed on the Video it
 * is on, so each Video starts from fresh state; only "More?" carries over,
 * and it is remembered in localStorage across opens.
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
  const [chain, dispatch] = useEffectReducer(
    lessonBodyChainReducer,
    () => createInitialLessonBodyChainState(videoId),
    {
      "find-next-video": (_state, effect, dispatch) => {
        fetch(`/api/videos/${effect.videoId}/next-video-needing-body`)
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const { nextVideoId } = (await response.json()) as {
              nextVideoId: string | null;
            };
            dispatch({
              type: "next-video-found",
              fromVideoId: effect.videoId,
              nextVideoId,
            });
          })
          .catch(() =>
            dispatch({
              type: "next-video-lookup-failed",
              fromVideoId: effect.videoId,
            })
          );
      },
      "close-writer": () => {
        onOpenChange(false);
      },
      "persist-more": (_state, effect) => writeStoredMore(effect.more),
      "show-toast": (_state, effect) => {
        if (effect.tone === "error") toast.error(effect.message);
        else toast(effect.message);
      },
    }
  );

  return (
    <LessonBodyWriter
      key={chain.videoId}
      videoId={chain.videoId}
      open={open}
      more={chain.more}
      onMoreChange={(checked) => dispatch({ type: "more-toggled", checked })}
      onApplied={() =>
        dispatch({ type: "body-applied", videoId: chain.videoId })
      }
      onClose={() => dispatch({ type: "writer-closed-by-hand" })}
    />
  );
}

/** One Video's writer. Keyed on `videoId` by its parent: never reused. */
function LessonBodyWriter({
  videoId,
  open,
  more,
  onMoreChange,
  onApplied,
  onClose,
}: {
  videoId: string;
  open: boolean;
  more: boolean;
  onMoreChange: (checked: boolean) => void;
  onApplied: () => void;
  onClose: () => void;
}) {
  const dataFetcher = useFetcher<LessonWriterData>();
  const { revalidate } = useRevalidator();

  useEffect(() => {
    if (open && dataFetcher.state === "idle" && !dataFetcher.data) {
      dataFetcher.load(`/api/videos/${videoId}/lesson-writer`).catch(() => {
        toast.error("Failed to load the lesson body");
      });
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
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      videoId={videoId}
      fieldId="video-body"
      modes={BODY_MODES}
      value={dataFetcher.data?.body ?? ""}
      context={context}
      onApply={persistBody}
      onApplied={onApplied}
      more={{ checked: more, onCheckedChange: onMoreChange }}
    />
  );
}
