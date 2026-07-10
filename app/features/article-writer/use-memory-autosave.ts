"use client";

import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";

export function useMemoryAutosave(memoryText: string, repoId: string | null) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const isInitialMount = useRef(true);
  const fetcher = useFetcher();

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (!repoId) return;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      fetcher.submit(
        { memory: memoryText },
        { method: "post", action: `/api/courses/${repoId}/update-memory` }
      );
    }, 750);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [memoryText, repoId]);
}
