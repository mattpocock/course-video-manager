"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import { toWriterContext } from "@/features/article-writer/use-writer-context";
import type { WriterContext } from "@/features/article-writer/writer-engine";
import type { WriterContextData } from "@/services/video-posting-context.server";

type VideoScriptData = {
  script: string | null;
  writerContext: WriterContextData;
};

/**
 * Load a video's Script + writer context from `/api/videos/$videoId/script`,
 * and persist edits back through the same route's `updateScript` intent. Shared
 * by the editor's inline Script tab ({@link ScriptPanel}) and the fullscreen
 * {@link ScriptWriterModal}, so the two surfaces can't drift.
 *
 * Pass `enabled` false to defer the fetch (the modal only loads once opened, so
 * each open starts from a fresh fetch). `script` reflects an in-flight save
 * immediately, so a preview never flashes stale text between submit and
 * revalidation.
 */
export function useVideoScript(videoId: string, enabled = true) {
  const dataFetcher = useFetcher<VideoScriptData>();
  const saveFetcher = useFetcher();

  useEffect(() => {
    if (enabled && dataFetcher.state === "idle" && !dataFetcher.data) {
      dataFetcher.load(`/api/videos/${videoId}/script`);
    }
  }, [enabled, videoId, dataFetcher]);

  const context = useMemo<WriterContext | null>(
    () =>
      dataFetcher.data ? toWriterContext(dataFetcher.data.writerContext) : null,
    [dataFetcher.data]
  );

  const persistScript = useCallback(
    (newValue: string) => {
      saveFetcher.submit(
        { intent: "updateScript", script: newValue },
        { method: "post", action: `/api/videos/${videoId}/script` }
      );
    },
    [saveFetcher, videoId]
  );

  const script = saveFetcher.formData
    ? String(saveFetcher.formData.get("script") ?? "")
    : (dataFetcher.data?.script ?? "");

  return {
    /** True once both the script and its writer context have loaded. */
    loaded: dataFetcher.data != null && context != null,
    script,
    context,
    persistScript,
  };
}
