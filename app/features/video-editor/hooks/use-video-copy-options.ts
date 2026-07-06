import { useCallback, useState } from "react";

const STORAGE_KEY = "video-copy:options";

export interface VideoCopyOptions {
  copyClips: boolean;
  copyBeats: boolean;
}

const DEFAULT_OPTIONS: VideoCopyOptions = {
  copyClips: true,
  copyBeats: true,
};

const readStoredOptions = (): VideoCopyOptions => {
  if (typeof window === "undefined") return DEFAULT_OPTIONS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<VideoCopyOptions>;
      return {
        copyClips: parsed.copyClips ?? true,
        copyBeats: parsed.copyBeats ?? true,
      };
    }
  } catch {
    // localStorage unavailable or JSON parse error — use defaults
  }
  return DEFAULT_OPTIONS;
};

/**
 * Persist the user's "Copy video" checkbox preferences globally (not per-video).
 * Mirrors {@link useReferenceVideoId}: in-memory state backed by localStorage,
 * degrading gracefully when storage is unavailable.
 */
export const useVideoCopyOptions = () => {
  const [options, setOptionsState] =
    useState<VideoCopyOptions>(readStoredOptions);

  const setOptions = useCallback((next: VideoCopyOptions) => {
    setOptionsState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage unavailable; in-memory state still works for the session
    }
  }, []);

  return [options, setOptions] as const;
};
