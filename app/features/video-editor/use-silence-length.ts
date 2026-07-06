import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SILENCE_LENGTH,
  type SilenceLength,
} from "@/silence-detection-constants";

const STORAGE_KEY = "video-editor:silenceLength";

const isSilenceLength = (value: unknown): value is SilenceLength =>
  value === "short" || value === "long";

const readFromStorage = (): SilenceLength => {
  if (typeof window === "undefined") return DEFAULT_SILENCE_LENGTH;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isSilenceLength(stored) ? stored : DEFAULT_SILENCE_LENGTH;
};

export const useSilenceLength = () => {
  const [silenceLength, setSilenceLengthState] = useState<SilenceLength>(
    DEFAULT_SILENCE_LENGTH
  );

  useEffect(() => {
    setSilenceLengthState(readFromStorage());
  }, []);

  const setSilenceLength = useCallback((next: SilenceLength) => {
    setSilenceLengthState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  }, []);

  return [silenceLength, setSilenceLength] as const;
};
