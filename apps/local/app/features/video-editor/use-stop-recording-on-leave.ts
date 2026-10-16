import { useEffect, useRef } from "react";

/**
 * Stop as the page goes away (#2182, #2196): a refresh, closing the tab, or
 * leaving the editor (`stopsOnLeave`). `pagehide` gives no time for a
 * render, so whether this editor is recording is read from a ref, and `stop`
 * must outlive the page (the CVM recorder's fetch goes with `keepalive`). The take is kept:
 * Stop closes the files as the Stop button does. Window blur does not stop:
 * a take is filmed with focus elsewhere. The next page stops whatever is
 * still going (Attaching, `recorder-session-reducer.ts`).
 */
export const useStopRecordingOnLeave = (
  recording: boolean,
  stop: () => void
) => {
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => {
    const leave = () => {
      if (!recordingRef.current) return;
      recordingRef.current = false;
      stopRef.current();
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, []);
};
