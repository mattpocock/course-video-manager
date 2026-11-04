import { useSyncExternalStore } from "react";
import { formatRunningClock } from "@/lib/format-duration";

/**
 * THE LIVE TIMER: how long the Live Stream has been live, as `HH:MM:SS`,
 * counted from `liveSince` (when it first went `live`, stamped by the app
 * server's recorder client, so a reload, a second tab and the pop-out all
 * read the same). Null when not live. Only in CVM's own UI: never on the
 * Live Stream picture or in an Overlay.
 */
export const liveTimer = (
  liveSince: string | null,
  nowMs: number
): string | null =>
  liveSince === null
    ? null
    : formatRunningClock((nowMs - Date.parse(liveSince)) / 1000);

const TICK_MS = 1000;
let nowMs = Date.now();
const ticked = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | undefined;

const subscribeToTick = (onTick: () => void) => {
  ticked.add(onTick);
  if (ticker === undefined) {
    nowMs = Date.now();
    ticker = setInterval(() => {
      nowMs = Date.now();
      for (const listener of ticked) listener();
    }, TICK_MS);
  }
  return () => {
    ticked.delete(onTick);
    if (ticked.size > 0 || ticker === undefined) return;
    clearInterval(ticker);
    ticker = undefined;
  };
};

/** The clock, once a second, for the Live Timer: one ticker for every reader. */
export const useNowMs = (): number =>
  useSyncExternalStore(
    subscribeToTick,
    () => nowMs,
    () => 0
  );

/**
 * The Live Timer, drawn: nothing when not live. The Streaming tab's toolbar
 * and the pop-out each pass their own look.
 */
export const LiveTimer = (props: {
  liveSince: string | null;
  className?: string;
}) => {
  const text = liveTimer(props.liveSince, useNowMs());
  if (text === null) return null;
  return (
    <span
      className={props.className}
      data-testid="live-timer"
      title="How long the Live Stream has been live"
    >
      {text}
    </span>
  );
};
