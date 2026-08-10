import { useRevalidator } from "react-router";
import { useEffect } from "react";

interface UseFocusRevalidateOptions {
  /**
   * Whether to enable focus-based revalidation
   * @default true
   */
  enabled?: boolean;
  /**
   * Optional interval in ms for periodic revalidation
   */
  intervalMs?: number;
}

/**
 * Hook that triggers revalidation when the page is brought into focus.
 * Optionally supports periodic revalidation via interval.
 */
export function useFocusRevalidate(options: UseFocusRevalidateOptions = {}) {
  const { enabled = true, intervalMs } = options;
  const revalidator = useRevalidator();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const abortController = new AbortController();

    const revalidate = () => {
      revalidator.revalidate();
    };

    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible") {
          revalidate();
        }
      },
      {
        signal: abortController.signal,
      }
    );

    let interval: ReturnType<typeof setInterval> | undefined;
    if (intervalMs) {
      interval = setInterval(() => {
        revalidate();
      }, intervalMs);
    }

    return () => {
      abortController.abort();
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [enabled, intervalMs, revalidator]);
}
