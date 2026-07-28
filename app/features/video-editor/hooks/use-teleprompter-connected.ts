/**
 * Is a teleprompter popup attached to this editor?
 *
 * `teleprompter-window` already records the popup's pings for every tab that
 * imports it; this turns that into React state. Polled on a timer rather than
 * subscribed because liveness *expires* — the popup being closed sends no
 * message, it just stops pinging.
 *
 * The tick is a second, an order of magnitude finer than the 5s window and well
 * under the delay you'd notice when opening the glass. A settled connection
 * costs nothing to hold: `setState` with an unchanged boolean bails out, so the
 * editor re-renders on the transitions rather than once a second.
 */
import { useEffect, useState } from "react";
import { isTeleprompterAlive } from "@/lib/teleprompter-window";

const POLL_INTERVAL_MS = 1000;

export function useTeleprompterConnected(): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const check = () => setConnected(isTeleprompterAlive());
    check();
    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return connected;
}
