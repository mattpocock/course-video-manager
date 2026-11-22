import { useRevalidator } from "react-router";
import { toast } from "@/components/ui/toast";
import { useEffect } from "react";
import { every } from "@/packages/clock";

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
      revalidator.revalidate().catch(() => {
        toast.error("Failed to refresh the page");
      });
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

    let stopTimer: (() => void) | undefined;
    if (intervalMs) {
      stopTimer = every(intervalMs, () => {
        revalidate();
      });
    }

    return () => {
      abortController.abort();
      if (stopTimer) {
        stopTimer();
      }
    };
  }, [enabled, intervalMs, revalidator]);
}
