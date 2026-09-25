import { useCallback, useMemo } from "react";
import {
  type BannedPhrase,
  DEFAULT_BANNED_PHRASES,
} from "@/features/article-writer/lint-rules";
import { useLocalStorage } from "./use-local-storage";

const STORAGE_KEY = "banned-phrases";

function isBannedPhrase(value: unknown): value is BannedPhrase {
  if (typeof value !== "object" || value === null) return false;
  const phrase = value as Record<string, unknown>;
  return (
    typeof phrase.pattern === "string" &&
    typeof phrase.readable === "string" &&
    typeof phrase.caseSensitive === "boolean"
  );
}

/**
 * A stored phrase list that survives a bad or hand-edited value. A value that
 * is not an array at all falls back to the defaults; an array keeps only the
 * entries that are the right shape, so one malformed entry cannot break the
 * lint rules built from the list.
 */
export function parseBannedPhrases(raw: string): BannedPhrase[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_BANNED_PHRASES;
    return parsed.filter(isBannedPhrase);
  } catch {
    return DEFAULT_BANNED_PHRASES;
  }
}

/**
 * Hook to manage custom banned phrases stored in localStorage.
 * Initializes with DEFAULT_BANNED_PHRASES if no stored phrases exist.
 */
export function useBannedPhrases() {
  const [raw, setRaw] = useLocalStorage(
    STORAGE_KEY,
    JSON.stringify(DEFAULT_BANNED_PHRASES)
  );

  const phrases = useMemo(() => parseBannedPhrases(raw), [raw]);

  const updatePhrases = useCallback(
    (update: (prev: BannedPhrase[]) => BannedPhrase[]) => {
      setRaw((prevRaw) => JSON.stringify(update(parseBannedPhrases(prevRaw))));
    },
    [setRaw]
  );

  const addPhrase = useCallback(
    (pattern: string, readable: string, caseSensitive: boolean) => {
      updatePhrases((prev) => [...prev, { pattern, readable, caseSensitive }]);
    },
    [updatePhrases]
  );

  const removePhrase = useCallback(
    (index: number) => {
      updatePhrases((prev) => prev.filter((_, i) => i !== index));
    },
    [updatePhrases]
  );

  const updatePhrase = useCallback(
    (index: number, updated: Partial<BannedPhrase>) => {
      updatePhrases((prev) =>
        prev.map((phrase, i) =>
          i === index ? { ...phrase, ...updated } : phrase
        )
      );
    },
    [updatePhrases]
  );

  const resetToDefaults = useCallback(() => {
    updatePhrases(() => DEFAULT_BANNED_PHRASES);
  }, [updatePhrases]);

  return {
    phrases,
    addPhrase,
    removePhrase,
    updatePhrase,
    resetToDefaults,
  };
}
