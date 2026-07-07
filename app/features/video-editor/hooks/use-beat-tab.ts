import { useCallback, useEffect, useState } from "react";
import type { BeatTab } from "../beat-tab";

const storageKey = (videoId: string) => `video-editor:beat-tab:${videoId}`;

const isBeatTab = (value: string | null): value is BeatTab =>
  value === "beats" || value === "reference";

/**
 * Persist which side-panel tab (Beats / Reference) the author last had open
 * for a given video, so reopening the editor restores their view. Mirrors
 * {@link useReferenceVideoId}: in-memory state backed by localStorage, keyed
 * per video, degrading gracefully when storage is unavailable.
 */
export const useBeatTab = (videoId: string) => {
  const [persistedTab, setState] = useState<BeatTab | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(videoId));
      setState(isBeatTab(raw) ? raw : null);
    } catch {
      setState(null);
    }
  }, [videoId]);

  const setPersistedTab = useCallback(
    (next: BeatTab | null) => {
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

  return [persistedTab, setPersistedTab] as const;
};
