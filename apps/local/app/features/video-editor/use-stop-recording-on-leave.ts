import { useEffect, useRef } from "react";

/**
 * Stop as the editor goes away (#2182, #2196): New Short, any other page or
 * Video, a refresh, or closing the tab. Navigation is never blocked.
 * `following` is the Recording Session the editor follows, recording or
 * already stopping (`followedOnLeave`); `leave` hands it back to the
 * Recorder, which stops it as Stop does and places its last Take where the
 * editor's Insertion Point was. `pagehide` gives no time for a render, so
 * both are read from refs, and `leave` must outlive the page (the CVM
 * recorder's fetch goes with `keepalive`): on a tab close that is best
 * effort, and the next page stops whatever is still going (Attaching,
 * `recorder-session-reducer.ts`). Window blur does not stop: a take is filmed
 * with focus elsewhere.
 */
export const useStopRecordingOnLeave = (
  following: string | null,
  leave: (recordingSessionId: string) => void
) => {
  const followingRef = useRef(following);
  followingRef.current = following;
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    const onLeave = () => {
      const recordingSessionId = followingRef.current;
      if (recordingSessionId === null) return;
      followingRef.current = null;
      leaveRef.current(recordingSessionId);
    };
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      onLeave();
    };
  }, []);
};
