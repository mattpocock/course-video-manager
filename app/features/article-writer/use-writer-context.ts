"use client";

import { useState, useEffect } from "react";
import type { WriterContextData } from "@/services/video-posting-context.server";
import type { WriterContext } from "./writer-engine";

/**
 * Project the server-loaded {@link WriterContextData} down to the client
 * {@link WriterContext} the writer engine consumes. Shared between the deferred
 * hook and callers that fetch the context on demand.
 */
export function toWriterContext(data: WriterContextData): WriterContext {
  return {
    files: data.files,
    transcript: data.transcript,
    transcriptWordCount: data.transcriptWordCount,
    chapters: data.chapters,
    indexedClips: data.indexedClips,
    links: data.links.map((l) => ({
      id: l.id,
      url: l.url,
      title: l.title,
    })),
    courseStructure: data.courseStructure,
    memory: data.memory,
    repoId: data.repoId,
    fullPath: data.fullPath,
    isStandalone: data.isStandalone,
    beats: data.beats,
  };
}

export function useWriterContext(
  writerContextPromise: Promise<WriterContextData> | undefined
): WriterContext | null {
  const [ctx, setCtx] = useState<WriterContext | null>(null);

  useEffect(() => {
    if (!writerContextPromise) return;
    let cancelled = false;
    writerContextPromise
      .then((data) => {
        if (!cancelled) {
          setCtx(toWriterContext(data));
        }
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [writerContextPromise]);

  return ctx;
}
