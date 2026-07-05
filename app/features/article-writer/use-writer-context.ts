"use client";

import { useState, useEffect } from "react";
import type { WriterContextData } from "@/services/video-posting-context.server";
import type { WriterContext } from "./writer-engine";

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
          setCtx({
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
          });
        }
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [writerContextPromise]);

  return ctx;
}
