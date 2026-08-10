import { useCallback, useEffect, useState } from "react";

const storageKey = (videoId: string) => `video-editor:reference:${videoId}`;

export const useReferenceVideoId = (videoId: string) => {
  const [referenceVideoId, setState] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(videoId));
      setState(raw && raw.length > 0 ? raw : null);
    } catch {
      setState(null);
    }
  }, [videoId]);

  const setReferenceVideoId = useCallback(
    (next: string | null) => {
      setState(next);
      try {
        if (next) {
          window.localStorage.setItem(storageKey(videoId), next);
        } else {
          window.localStorage.removeItem(storageKey(videoId));
        }
      } catch {
        // localStorage unavailable; in-memory state still works for the session
      }
    },
    [videoId]
  );

  return [referenceVideoId, setReferenceVideoId] as const;
};
