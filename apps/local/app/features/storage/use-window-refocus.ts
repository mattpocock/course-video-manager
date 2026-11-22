import { useEffect } from "react";
import { nowMs } from "@/packages/clock";

/**
 * The bridge from the window coming back to a Storage page (#2423): focus,
 * or the tab becoming visible again. It reports the time; the page's
 * reducer decides whether what it shows is old enough to walk again.
 */
export const useWindowRefocus = (
  dispatch: (action: { type: "window-refocused"; now: number }) => void
) => {
  useEffect(() => {
    const refocused = () => {
      if (document.visibilityState === "visible") {
        dispatch({ type: "window-refocused", now: nowMs() });
      }
    };
    window.addEventListener("focus", refocused);
    document.addEventListener("visibilitychange", refocused);
    return () => {
      window.removeEventListener("focus", refocused);
      document.removeEventListener("visibilitychange", refocused);
    };
  }, [dispatch]);
};
