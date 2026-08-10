import { useState, useEffect, useCallback } from "react";
import {
  type BannedPhrase,
  DEFAULT_BANNED_PHRASES,
} from "@/features/article-writer/lint-rules";

const STORAGE_KEY = "banned-phrases";

/**
 * Hook to manage custom banned phrases stored in localStorage.
 * Initializes with DEFAULT_BANNED_PHRASES if no stored phrases exist.
 */
export function useBannedPhrases() {
  const [phrases, setPhrases] = useState<BannedPhrase[]>(() => {
    if (typeof localStorage === "undefined") {
      return DEFAULT_BANNED_PHRASES;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        return JSON.parse(stored) as BannedPhrase[];
      } catch {
        return DEFAULT_BANNED_PHRASES;
      }
    }
    // Initialize with defaults on first load
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_BANNED_PHRASES));
    return DEFAULT_BANNED_PHRASES;
  });

  // Persist to localStorage whenever phrases change
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(phrases));
    }
  }, [phrases]);

  const addPhrase = useCallback(
    (pattern: string, readable: string, caseSensitive: boolean) => {
      setPhrases((prev) => [...prev, { pattern, readable, caseSensitive }]);
    },
    []
  );

  const removePhrase = useCallback((index: number) => {
    setPhrases((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updatePhrase = useCallback(
    (index: number, updated: Partial<BannedPhrase>) => {
      setPhrases((prev) =>
        prev.map((phrase, i) =>
          i === index ? { ...phrase, ...updated } : phrase
        )
      );
    },
    []
  );

  const resetToDefaults = useCallback(() => {
    setPhrases(DEFAULT_BANNED_PHRASES);
  }, []);

  return {
    phrases,
    addPhrase,
    removePhrase,
    updatePhrase,
    resetToDefaults,
  };
}
