import { useSyncExternalStore } from "react";
import { formatRunningClock } from "@/lib/format-duration";
import { nowMs as clockNowMs, every, toDate } from "@/packages/clock";

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
    : formatRunningClock((nowMs - toDate(liveSince).getTime()) / 1000);

const TICK_MS = 1000;
let nowMs = clockNowMs();
const ticked = new Set<() => void>();
let stopTicker: (() => void) | undefined;

const subscribeToTick = (onTick: () => void) => {
  ticked.add(onTick);
  if (stopTicker === undefined) {
    nowMs = clockNowMs();
    stopTicker = every(TICK_MS, () => {
      nowMs = clockNowMs();
      for (const listener of ticked) listener();
    });
  }
  return () => {
    ticked.delete(onTick);
    if (ticked.size > 0 || stopTicker === undefined) return;
    stopTicker();
    stopTicker = undefined;
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
